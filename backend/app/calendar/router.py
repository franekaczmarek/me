"""Calendar API: events (expanded into occurrences), weekly work schedule and days off (vacations, holidays)."""

from datetime import date, time
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from app.calendar.capacity import DEFAULT_SCHEDULE, DayOff, WorkSchedule
from app.calendar.events import occurrences
from app.calendar.schemas import EVENT_COLUMNS, Event, EventIn, Occurrence, to_occurrence
from app.core.supabase import Supabase, SupabaseDep, one_or_404

router = APIRouter(prefix="/calendar", tags=["calendar"])

SCHEDULE = "calendar_work_schedule"
DAYS_OFF = "calendar_days_off"
EVENTS = "calendar_events"
SCHEDULE_COLUMNS = "work_days,work_start,work_end,task_minutes_workday,task_minutes_day_off"
DAY_OFF_COLUMNS = "id,start_date,end_date,label"

Minutes = Annotated[int, Field(ge=0, le=1440)]


class Schedule(BaseModel):
    work_days: list[int] = Field(description="ISO weekdays, 1 = Monday … 7 = Sunday")
    work_start: time
    work_end: time
    task_minutes_workday: Minutes
    task_minutes_day_off: Minutes

    @field_validator("work_days")
    @classmethod
    def _valid_days(cls, days: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in days):
            raise ValueError("Weekdays are 1 (Monday) to 7 (Sunday)")
        return sorted(set(days))

    @model_validator(mode="after")
    def _end_after_start(self) -> Self:
        if self.work_end <= self.work_start:
            raise ValueError("work_end must be after work_start")
        return self

    def to_capacity(self) -> WorkSchedule:
        return WorkSchedule(**{**self.model_dump(), "work_days": tuple(self.work_days)})


DEFAULT = Schedule(**{**DEFAULT_SCHEDULE.__dict__, "work_days": list(DEFAULT_SCHEDULE.work_days)})


class DayOffCreate(BaseModel):
    start_date: date
    end_date: date
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


class DayOffOut(DayOffCreate):
    id: UUID


# --- shared loaders (also used by the to-do module) -------------------------------


def load_schedule(db: Supabase) -> Schedule:
    rows = db.rest("GET", SCHEDULE, params={"select": SCHEDULE_COLUMNS})
    return Schedule(**rows[0]) if rows else DEFAULT


def load_days_off(db: Supabase, start: date, end: date) -> list[DayOff]:
    """Days off overlapping [start, end]."""
    rows = db.rest(
        "GET",
        DAYS_OFF,
        params={"select": DAY_OFF_COLUMNS, "start_date": f"lte.{end}", "end_date": f"gte.{start}"},
    )
    return [DayOff(date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"]), r["label"]) for r in rows]


# --- routes -------------------------------------------------------------------------


@router.get("/work-schedule", response_model=Schedule)
def read_schedule(db: SupabaseDep) -> Schedule:
    """The saved schedule, or the default (Mon–Fri 9–17) until one is saved."""
    return load_schedule(db)


@router.put("/work-schedule", response_model=Schedule)
def save_schedule(body: Schedule, db: SupabaseDep) -> Any:
    rows = db.rest(
        "POST",
        SCHEDULE,
        params={"select": SCHEDULE_COLUMNS, "on_conflict": "user_id"},
        json={"user_id": db.user_id, **body.model_dump(mode="json")},
        prefer="resolution=merge-duplicates,return=representation",
    )
    return rows[0]


@router.get("/days-off", response_model=list[DayOffOut])
def list_days_off(db: SupabaseDep) -> Any:
    return db.rest("GET", DAYS_OFF, params={"select": DAY_OFF_COLUMNS, "order": "start_date.asc"})


@router.post("/days-off", response_model=DayOffOut, status_code=status.HTTP_201_CREATED)
def create_day_off(body: DayOffCreate, db: SupabaseDep) -> Any:
    return db.rest("POST", DAYS_OFF, params={"select": DAY_OFF_COLUMNS}, json=body.model_dump(mode="json"))[0]


@router.delete("/days-off/{day_off_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_day_off(day_off_id: UUID, db: SupabaseDep) -> Response:
    one_or_404(db.rest("DELETE", DAYS_OFF, params={"id": f"eq.{day_off_id}", "select": "id"}), "Day off")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- events -------------------------------------------------------------------------

#: Longest range one request may expand (a year view plus margins).
MAX_RANGE_DAYS = 400


def load_events(db: Supabase, start: date, end: date) -> list[Event]:
    """Events that may have an occurrence in [start, end]: starting before its end and not finished repeating."""
    rows = db.rest(
        "GET",
        EVENTS,
        params={
            "select": EVENT_COLUMNS,
            "start_date": f"lte.{end}",
            "or": f"(recurrence.neq.none,end_date.gte.{start})",
            "order": "start_date.asc,start_time.asc.nullsfirst",
        },
    )
    return [Event(**row) for row in rows]


def load_occurrences(db: Supabase, start: date, end: date) -> list[Occurrence]:
    """All event occurrences overlapping [start, end]; all-day first on each day, then by time."""
    found = [
        to_occurrence(event, span)
        for event in load_events(db, start, end)
        for span in occurrences(event.span(), start, end)
    ]
    return sorted(found, key=lambda o: (o.start_date, not o.all_day, o.start_time or time(), o.title))


@router.get("/events", response_model=list[Occurrence])
def list_occurrences(start: date, end: date, db: SupabaseDep) -> Any:
    """Occurrences (repeating events expanded) overlapping [start, end]."""
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Give a range of 0–{MAX_RANGE_DAYS} days")
    return load_occurrences(db, start, end)


@router.get("/events/{event_id}", response_model=Event)
def read_event(event_id: UUID, db: SupabaseDep) -> Any:
    return one_or_404(db.rest("GET", EVENTS, params={"id": f"eq.{event_id}", "select": EVENT_COLUMNS}), "Event")


@router.post("/events", response_model=Event, status_code=status.HTTP_201_CREATED)
def create_event(body: EventIn, db: SupabaseDep) -> Any:
    return db.rest("POST", EVENTS, params={"select": EVENT_COLUMNS}, json=body.row())[0]


@router.put("/events/{event_id}", response_model=Event)
def replace_event(event_id: UUID, body: EventIn, db: SupabaseDep) -> Any:
    rows = db.rest("PATCH", EVENTS, params={"id": f"eq.{event_id}", "select": EVENT_COLUMNS}, json=body.row())
    return one_or_404(rows, "Event")


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: UUID, db: SupabaseDep) -> Response:
    one_or_404(db.rest("DELETE", EVENTS, params={"id": f"eq.{event_id}", "select": "id"}), "Event")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
