"""Side cards of the calendar: a month summary and what's coming up in the next 30 days."""

from datetime import date, time, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.calendar.capacity import DayOff
from app.calendar.events import add_months, minutes_on
from app.calendar.router import load_days_off, load_occurrences
from app.calendar.schemas import Occurrence
from app.core.supabase import Supabase, SupabaseDep, parallel

router = APIRouter(prefix="/calendar", tags=["calendar"])

#: How far ahead "Upcoming" (and task suggestions) look.
HORIZON_DAYS = 30
UPCOMING_LIMIT = 12


class MonthSummary(BaseModel):
    month: date
    events: int
    #: Time taken by timed events this month.
    event_minutes: int
    busiest_day: date | None
    busiest_day_events: int
    days_off: int
    tasks_done: int
    tasks_open: int
    #: Open tasks planned on a day before today.
    tasks_overdue: int


class Upcoming(BaseModel):
    id: UUID
    title: str
    color: str
    start_date: date
    end_date: date
    start_time: time | None
    all_day: bool
    occurrence_date: date
    days_until: int
    #: A to-do task was already created for this occurrence.
    has_task: bool


class Summary(BaseModel):
    month: MonthSummary
    upcoming: list[Upcoming]


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=n) for n in range((end - start).days + 1)]


def summarize_month(
    first: date, found: list[Occurrence], days_off: list[DayOff], tasks: list[dict[str, Any]], today: date
) -> MonthSummary:
    last = add_months(first, 1) - timedelta(days=1)
    month = _days(first, last)
    per_day = {day: sum(o.start_date <= day <= o.end_date for o in found) for day in month}
    busiest = max(month, key=lambda d: per_day[d])  # the earliest of equally busy days
    planned = [t for t in tasks if first.isoformat() <= t["planned_date"] <= last.isoformat()]
    open_tasks = [t for t in planned if t["status"] == "open"]
    return MonthSummary(
        month=first,
        events=sum(1 for o in found if o.end_date >= first and o.start_date <= last),
        event_minutes=sum(minutes_on(o.span(), day) for o in found for day in month),
        busiest_day=busiest if per_day[busiest] else None,
        busiest_day_events=per_day[busiest],
        days_off=sum(any(off.start <= day <= off.end for off in days_off) for day in month),
        tasks_done=sum(t["status"] == "done" for t in planned),
        tasks_open=len(open_tasks),
        tasks_overdue=sum(t["planned_date"] < today.isoformat() for t in open_tasks),
    )


def upcoming(found: list[Occurrence], today: date, linked: set[tuple[str, str]]) -> list[Upcoming]:
    """The next occurrence of each event from today (including ones still running) up to the horizon, soonest first."""
    soon: list[Occurrence] = []
    seen: set[UUID] = set()
    for o in found:
        if o.end_date >= today and o.start_date <= today + timedelta(days=HORIZON_DAYS) and o.id not in seen:
            seen.add(o.id)
            soon.append(o)
    return [
        Upcoming(
            **o.model_dump(include={"id", "title", "color", "start_date", "end_date", "start_time", "all_day"}),
            occurrence_date=o.occurrence_date,
            days_until=max(0, (o.start_date - today).days),
            has_task=(str(o.id), o.occurrence_date.isoformat()) in linked,
        )
        for o in soon[:UPCOMING_LIMIT]
    ]


def _between(column: str, start: date, end: date) -> str:
    return f"({column}.gte.{start},{column}.lte.{end})"


def load_linked(db: Supabase, start: date, end: date) -> set[tuple[str, str]]:
    """(event id, occurrence date) pairs that already have a to-do task."""
    rows = db.rest(
        "GET",
        "todo_tasks",
        params={
            "select": "source_event_id,source_occurrence_date",
            "source_event_id": "not.is.null",
            "and": _between("source_occurrence_date", start, end),
        },
    )
    return {(r["source_event_id"], r["source_occurrence_date"]) for r in rows}


@router.get("/summary", response_model=Summary)
def read_summary(
    db: SupabaseDep,
    month: Annotated[date, Query(description="Any day of the month to summarize")],
    today: Annotated[date, Query(description="The user's local date")],
) -> Summary:
    first = month.replace(day=1)
    last = add_months(first, 1) - timedelta(days=1)
    horizon = today + timedelta(days=HORIZON_DAYS)
    start, end = min(first, today), max(last, horizon)

    found, tasks, days_off, linked = parallel(
        lambda: load_occurrences(db, start, end),
        lambda: db.rest(
            "GET", "todo_tasks", params={"select": "planned_date,status", "and": _between("planned_date", first, last)}
        ),
        lambda: load_days_off(db, first, last),
        lambda: load_linked(db, today, horizon),
    )
    in_month = [o for o in found if o.end_date >= first and o.start_date <= last]
    return Summary(
        month=summarize_month(first, in_month, days_off, tasks, today),
        upcoming=upcoming(found, today, linked),
    )
