"""To-do API: the days feed, tasks, completing and reopening. All queries run as the user (RLS)."""

from datetime import UTC, date, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel

from app.calendar.router import MAX_RANGE_DAYS, load_days_off, load_occurrences, load_schedule
from app.core.supabase import Supabase, SupabaseDep, one_or_404, parallel
from app.todo.days import build_days, window_end
from app.todo.recurrence import Rule, occurrences
from app.todo.schemas import TASK_COLUMNS, DaysFeed, Task, TaskCreate, TaskUpdate, task_row

router = APIRouter(prefix="/todo", tags=["todo"])

TASKS = "todo_tasks"
ROUTINES = "todo_routines"
ROUTINE_COLUMNS = "id,title,notes,kind,weekdays,interval_days,month_day,duration_min,priority,starts_on"

# The client sends its local date, so "today" matches the user's time zone.
TodayParam = Annotated[date | None, Query(description="The user's local date; defaults to the server's")]


class CompleteBody(BaseModel):
    today: date | None = None


def _today(value: date | None) -> date:
    return value or date.today()


def routine_occurrences(routines: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    """Task rows for every occurrence of the routines from today to the end of the window."""
    rows = []
    for r in routines:
        rule = Rule(
            kind=r["kind"],
            starts_on=date.fromisoformat(r["starts_on"]),
            weekdays=tuple(r["weekdays"] or ()),
            interval_days=r["interval_days"],
            month_day=r["month_day"],
        )
        for day in occurrences(rule, today, window_end(today)):
            rows.append(
                {
                    "title": r["title"],
                    "notes": r["notes"],
                    "planned_date": day.isoformat(),
                    "duration_min": r["duration_min"],
                    "priority": r["priority"],
                    "routine_id": r["id"],
                    "occurrence_date": day.isoformat(),
                }
            )
    return rows


@router.get("/days", response_model=DaysFeed)
def read_days(
    db: SupabaseDep,
    today: TodayParam = None,
    sync: Annotated[bool, Query(description="false skips the routine sync (e.g. right after a change)")] = True,
) -> DaysFeed:
    """Overdue days, today, the coming week and planned days up to 2 weeks ahead, plus the inbox.

    Also syncs routines: creates their missing occurrences and marks past undone ones as missed.
    Everything is read at once and written only when something changed (about once a day).
    """
    day = _today(today)
    end = window_end(day)
    routines, rows, schedule, events = parallel(
        lambda: db.rest("GET", ROUTINES, params={"select": ROUTINE_COLUMNS, "active": "eq.true"}) if sync else [],
        lambda: db.rest(
            "GET",
            TASKS,
            params={
                "select": TASK_COLUMNS,
                # Skipped (missed) occurrences in the window are read too, so they aren't re-created.
                "or": (
                    f"(and(planned_date.is.null,status.neq.missed),and(planned_date.gte.{day},planned_date.lte.{end}),"
                    f"and(planned_date.lt.{day},status.eq.open))"
                ),
            },
        ),
        lambda: load_schedule(db),
        lambda: load_occurrences(db, day, end),
    )

    def past_routine_task(r: dict[str, Any]) -> bool:
        return sync and r["routine_id"] is not None and r["planned_date"] is not None and r["planned_date"] < str(day)

    existing = {(r["routine_id"], r["occurrence_date"]) for r in rows if r["routine_id"]}
    # Occurrences the user moved beyond the window look missing too; inserting them again is a no-op.
    missing = [o for o in routine_occurrences(routines, day) if (o["routine_id"], o["occurrence_date"]) not in existing]
    missed = any(past_routine_task(r) for r in rows)
    tasks = [Task(**r) for r in rows if r["status"] != "missed" and not past_routine_task(r)]
    # Overdue days are shown too, so days off are needed from the oldest of them.
    first = min([t.planned_date for t in tasks if t.planned_date] + [day])

    calls = [lambda: load_days_off(db, first, end)]
    if missing:
        calls.append(
            lambda: db.rest(
                "POST",
                TASKS,
                params={"on_conflict": "routine_id,occurrence_date", "select": TASK_COLUMNS},
                json=missing,
                # Only rows actually inserted come back; existing occurrences are left alone.
                prefer="resolution=ignore-duplicates,return=representation",
            )
        )
    if missed:
        calls.append(
            lambda: db.rest(
                "PATCH",
                TASKS,
                params={"routine_id": "not.is.null", "status": "eq.open", "planned_date": f"lt.{day}"},
                json={"status": "missed"},
                prefer="return=minimal",
            )
        )
    days_off, *written = parallel(*calls)
    if missing:
        tasks += [Task(**r) for r in written[0]]
    days, inbox = build_days(tasks, day, schedule.to_capacity(), days_off, events)
    return DaysFeed(today=day, days=days, inbox=inbox)


@router.get("/tasks", response_model=list[Task])
def list_tasks(start: date, end: date, db: SupabaseDep) -> Any:
    """Tasks planned in [start, end] (open and done; missed routine occurrences are left out)."""
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Give a range of 0–{MAX_RANGE_DAYS} days")
    return db.rest(
        "GET",
        TASKS,
        params={
            "select": TASK_COLUMNS,
            "status": "neq.missed",
            "and": f"(planned_date.gte.{start},planned_date.lte.{end})",
            "order": "planned_date.asc,position.asc,created_at.asc",
        },
    )


@router.post("/tasks", response_model=Task, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskCreate, db: SupabaseDep) -> Any:
    return db.rest("POST", TASKS, params={"select": TASK_COLUMNS}, json=task_row(body.model_dump()))[0]


@router.patch("/tasks/{task_id}", response_model=Task)
def update_task(task_id: UUID, body: TaskUpdate, db: SupabaseDep) -> Any:
    changes = task_row(body.model_dump(exclude_unset=True))
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No fields to update")
    if changes.get("planned_date", "unset") is None:
        changes["fixed_day"] = False  # back to the inbox: no longer tied to a day
    rows = db.rest("PATCH", TASKS, params={"id": f"eq.{task_id}", "select": TASK_COLUMNS}, json=changes)
    return one_or_404(rows, "Task")


@router.post("/tasks/{task_id}/complete", response_model=Task)
def complete_task(task_id: UUID, db: SupabaseDep, body: CompleteBody | None = None) -> Any:
    """Mark done now. A task done from the inbox is recorded on the day it was done."""
    task = one_or_404(db.rest("GET", TASKS, params={"id": f"eq.{task_id}", "select": "planned_date"}), "Task")
    changes: dict[str, Any] = {"status": "done", "completed_at": datetime.now(UTC).isoformat()}
    if task["planned_date"] is None:
        changes["planned_date"] = _today(body.today if body else None).isoformat()
    rows = db.rest("PATCH", TASKS, params={"id": f"eq.{task_id}", "select": TASK_COLUMNS}, json=changes)
    return one_or_404(rows, "Task")


@router.post("/tasks/{task_id}/reopen", response_model=Task)
def reopen_task(task_id: UUID, db: SupabaseDep) -> Any:
    rows = db.rest(
        "PATCH",
        TASKS,
        params={"id": f"eq.{task_id}", "select": TASK_COLUMNS},
        json={"status": "open", "completed_at": None},
    )
    return one_or_404(rows, "Task")


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: UUID, db: SupabaseDep) -> Response:
    """Deletes a task. A routine occurrence is skipped instead (marked missed), so it isn't re-created."""
    skipped = db.rest(
        "PATCH",
        TASKS,
        params={"id": f"eq.{task_id}", "routine_id": "not.is.null", "select": "id"},
        json={"status": "missed", "completed_at": None},
    )
    if not skipped:
        one_or_404(db.rest("DELETE", TASKS, params={"id": f"eq.{task_id}", "select": "id"}), "Task")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
