"""Request/response models for the to-do API."""

from datetime import date, datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

Priority = Literal["low", "normal", "high"]
Status = Literal["open", "done", "missed"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(max_length=5000)]
Duration = Annotated[int, Field(ge=1, le=1440, description="Estimated minutes")]

TASK_COLUMNS = (
    "id,title,notes,planned_date,deadline,duration_min,priority,fixed_day,status,completed_at,"
    "first_planned_date,postponed_count,routine_id,occurrence_date,position,created_at"
)


class TaskCreate(BaseModel):
    title: Title
    notes: Notes = ""
    planned_date: date | None = Field(None, description="Null keeps the task in the inbox")
    deadline: date | None = None
    duration_min: Duration | None = None
    priority: Priority = "normal"
    fixed_day: bool = Field(False, description="Must happen on its planned day; the planner won't move it")

    @model_validator(mode="after")
    def _fixed_needs_day(self) -> Self:
        if self.fixed_day and not self.planned_date:
            raise ValueError("A task fixed to its day needs a planned_date")
        return self


class TaskUpdate(BaseModel):
    """Partial update: only fields present in the request change. `planned_date: null` = to the inbox."""

    title: Title | None = None
    notes: Notes | None = None
    planned_date: date | None = None
    deadline: date | None = None
    duration_min: Duration | None = None
    priority: Priority | None = None
    fixed_day: bool | None = None
    position: Annotated[int, Field(ge=0)] | None = None

    @model_validator(mode="after")
    def _no_nulls(self) -> Self:
        for name in ("title", "notes", "priority", "fixed_day", "position"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class Task(BaseModel):
    id: UUID
    title: str
    notes: str
    planned_date: date | None
    deadline: date | None
    duration_min: int | None
    priority: Priority
    fixed_day: bool
    status: Status
    completed_at: datetime | None
    first_planned_date: date | None
    postponed_count: int
    routine_id: UUID | None
    occurrence_date: date | None
    position: int
    created_at: datetime


class Day(BaseModel):
    date: date
    is_today: bool
    #: A past day that still has undone tasks.
    is_overdue: bool
    is_work_day: bool
    capacity_min: int
    planned_min: int
    tasks: list[Task]


class DaysFeed(BaseModel):
    today: date
    days: list[Day]
    inbox: list[Task]


def task_row(data: dict[str, Any]) -> dict[str, Any]:
    """JSON-ready DB row from a model dump."""
    return {k: (v.isoformat() if isinstance(v, date) else v) for k, v in data.items()}
