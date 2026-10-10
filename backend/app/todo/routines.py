"""Routines API (recurring items) and to-do statistics."""

from datetime import date, datetime, timedelta
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, model_validator

from app.core.supabase import Supabase, SupabaseDep, one_or_404
from app.todo.recurrence import Kind
from app.todo.schemas import TASK_COLUMNS, Duration, Notes, Priority, Task, Title
from app.todo.stats import Stats, compute_stats

router = APIRouter(prefix="/todo", tags=["todo"])

ROUTINES = "todo_routines"
TASKS = "todo_tasks"
COLUMNS = "id,title,notes,kind,weekdays,interval_days,month_day,duration_min,priority,active,starts_on,created_at"

Weekday = Annotated[int, Field(ge=1, le=7)]
TodayParam = Annotated[date | None, Query(description="The user's local date; defaults to the server's")]


def _check_rule(kind: str | None, weekdays: list[int] | None, interval_days: int | None, month_day: int | None) -> None:
    if kind == "weekly" and not weekdays:
        raise ValueError("A weekly routine needs at least one weekday")
    if kind == "interval" and not interval_days:
        raise ValueError("An 'every N days' routine needs interval_days")
    if kind == "monthly" and not month_day:
        raise ValueError("A monthly routine needs month_day")


class RoutineCreate(BaseModel):
    title: Title
    notes: Notes = ""
    kind: Kind
    weekdays: list[Weekday] | None = None
    interval_days: Annotated[int, Field(ge=1, le=366)] | None = None
    month_day: Annotated[int, Field(ge=1, le=31)] | None = None
    duration_min: Duration | None = None
    priority: Priority = "normal"
    active: bool = True
    starts_on: date | None = None

    @model_validator(mode="after")
    def _rule(self) -> Self:
        _check_rule(self.kind, self.weekdays, self.interval_days, self.month_day)
        if self.weekdays:
            self.weekdays = sorted(set(self.weekdays))
        return self


class RoutineUpdate(BaseModel):
    title: Title | None = None
    notes: Notes | None = None
    kind: Kind | None = None
    weekdays: list[Weekday] | None = None
    interval_days: Annotated[int, Field(ge=1, le=366)] | None = None
    month_day: Annotated[int, Field(ge=1, le=31)] | None = None
    duration_min: Duration | None = None
    priority: Priority | None = None
    active: bool | None = None
    starts_on: date | None = None

    @model_validator(mode="after")
    def _validate(self) -> Self:
        for name in ("title", "notes", "kind", "priority", "active", "starts_on"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        if self.kind:
            _check_rule(self.kind, self.weekdays, self.interval_days, self.month_day)
        return self


class Routine(BaseModel):
    id: UUID
    title: str
    notes: str
    kind: Kind
    weekdays: list[int] | None
    interval_days: int | None
    month_day: int | None
    duration_min: int | None
    priority: Priority
    active: bool
    starts_on: date
    created_at: datetime


def _json(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v.isoformat() if isinstance(v, date) else v for k, v in data.items()}


def drop_future_occurrences(db: Supabase, routine_id: UUID, today: date) -> None:
    """Removes upcoming undone occurrences so they are re-created from the current rule."""
    db.rest(
        "DELETE",
        TASKS,
        params={"routine_id": f"eq.{routine_id}", "status": "eq.open", "planned_date": f"gte.{today}"},
        prefer="return=minimal",
    )


@router.get("/routines", response_model=list[Routine])
def list_routines(db: SupabaseDep) -> Any:
    return db.rest("GET", ROUTINES, params={"select": COLUMNS, "order": "active.desc,created_at.asc"})


@router.post("/routines", response_model=Routine, status_code=status.HTTP_201_CREATED)
def create_routine(body: RoutineCreate, db: SupabaseDep) -> Any:
    data = body.model_dump(exclude_none=True)
    return db.rest("POST", ROUTINES, params={"select": COLUMNS}, json=_json(data))[0]


@router.patch("/routines/{routine_id}", response_model=Routine)
def update_routine(routine_id: UUID, body: RoutineUpdate, db: SupabaseDep, today: TodayParam = None) -> Any:
    changes = _json(body.model_dump(exclude_unset=True))
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No fields to update")
    rows = db.rest("PATCH", ROUTINES, params={"id": f"eq.{routine_id}", "select": COLUMNS}, json=changes)
    row = one_or_404(rows, "Routine")
    drop_future_occurrences(db, routine_id, today or date.today())
    return row


@router.delete("/routines/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(routine_id: UUID, db: SupabaseDep, today: TodayParam = None) -> Response:
    """Removes the routine and its upcoming undone tasks; past ones stay for the statistics."""
    drop_future_occurrences(db, routine_id, today or date.today())
    one_or_404(db.rest("DELETE", ROUTINES, params={"id": f"eq.{routine_id}", "select": "id"}), "Routine")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stats", response_model=Stats)
def read_stats(
    db: SupabaseDep,
    today: TodayParam = None,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> Stats:
    day = today or date.today()
    start = day - timedelta(days=days - 1)
    rows = db.rest(
        "GET",
        TASKS,
        params={
            "select": TASK_COLUMNS,
            "or": (
                f"(completed_at.gte.{start}T00:00:00Z,planned_date.eq.{day},"
                f"and(status.eq.open,planned_date.lt.{day}),and(status.eq.open,deadline.lt.{day}),"
                f"and(status.eq.missed,planned_date.gte.{start}))"
            ),
        },
    )
    return compute_stats([Task(**r) for r in rows], day, days)
