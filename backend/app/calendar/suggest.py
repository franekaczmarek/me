"""Task suggestions from the calendar: Claude reads the events of the next 30 days and proposes what to do
for them ("Buy a present for Mom" ten days before her birthday, "Doctor visit" on the day of the visit).

Nothing is saved until the user accepts suggestions (`/suggest/apply`). Accepted and dismissed suggestions
are remembered per event occurrence, so the same one is never offered twice.
"""

import json
import re
from datetime import date, timedelta
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints

from app.calendar.router import load_occurrences
from app.calendar.schemas import Occurrence
from app.calendar.summary import HORIZON_DAYS
from app.core.claude import ClaudeDep, ask_structured
from app.core.supabase import Supabase, SupabaseDep

router = APIRouter(prefix="/calendar", tags=["calendar"])

LINKS = "calendar_task_links"
TASKS = "todo_tasks"
PER_EVENT = 3
MAX_SUGGESTIONS = 30

SYSTEM_PROMPT = """You help one person get ready for the events in their calendar by suggesting to-do tasks.

You get today's date and the events of the coming weeks. Each event has a ref, title, date, time (or all
day), days until it, notes and location, and `already_handled`: task titles the person already accepted or
turned down for it. For each event decide whether there is something to do, and suggest those tasks:

- Birthdays, name days, anniversaries: a present or wishes, early enough to get it (usually 7–14 days
  before; less when the event is close).
- Appointments (doctor, dentist, office, car service…): a task for the visit itself on its day, named
  like the event with its time (e.g. "Doctor visit at 15:30"); add a preparation task only when it is
  clearly useful (documents, referral, fasting).
- Trips and travel: packing, tickets, bookings, a few days before.
- Parties, dinners, meetings with others: only if something has to be brought or arranged.
- Nothing for routine or self-explanatory events (gym, weekly meetings, work blocks, days off).

Rules: most events need no task or one; never more than 3 per event. days_before is how many days before
the event to do the task (0 = on the day; never more than the days until the event). Never repeat or
rephrase anything in `already_handled`. Write titles short, in the language of the event title (Polish
stays Polish). duration_min is a realistic estimate. priority "high" only when it is urgent or the event
is very soon. deadline_is_event is true when the task must be done before the event starts. The reason is
at most 12 words."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "event_ref": {"type": "string"},
                    "title": {"type": "string"},
                    "days_before": {"type": "integer"},
                    "duration_min": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "priority": {"type": "string", "enum": ["low", "normal", "high"]},
                    "deadline_is_event": {"type": "boolean"},
                    "reason": {"type": "string"},
                },
                "required": ["event_ref", "title", "days_before", "duration_min", "priority", "deadline_is_event", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}

Priority = Literal["low", "normal", "high"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class SuggestRequest(BaseModel):
    today: date | None = None


class ClaudeSuggestion(BaseModel):
    event_ref: str
    title: str
    days_before: int
    duration_min: int | None = None
    priority: Priority = "normal"
    deadline_is_event: bool = False
    reason: str = ""


class ClaudeSuggestions(BaseModel):
    suggestions: list[ClaudeSuggestion]


class Suggestion(BaseModel):
    """A task proposed for an event occurrence (not saved)."""

    event_id: UUID
    occurrence_date: date
    event_title: str
    event_color: str
    title: str
    planned_date: date
    deadline: date | None
    duration_min: int | None
    priority: Priority
    fixed_day: bool
    reason: str


class SuggestResult(BaseModel):
    suggestions: list[Suggestion]
    #: How many event occurrences were looked at.
    events: int
    warnings: list[str]


class Accepted(BaseModel):
    event_id: UUID
    occurrence_date: date
    #: The title as suggested (remembered so it isn't suggested again), and as the user edited it.
    suggested_title: Title
    title: Title
    planned_date: date
    deadline: date | None = None
    duration_min: Annotated[int, Field(ge=1, le=1440)] | None = None
    priority: Priority = "normal"
    fixed_day: bool = False


class Dismissed(BaseModel):
    event_id: UUID
    occurrence_date: date
    suggested_title: Title


class ApplyRequest(BaseModel):
    today: date | None = None
    accepted: list[Accepted] = Field(default_factory=list, max_length=MAX_SUGGESTIONS)
    dismissed: list[Dismissed] = Field(default_factory=list, max_length=MAX_SUGGESTIONS)


class ApplyResult(BaseModel):
    created: int
    dismissed: int


def title_key(title: str) -> str:
    """Normalized title: the same suggestion is recognised despite case, spacing and punctuation."""
    return " ".join(re.sub(r"[^\w]+", " ", title.lower()).split())[:200]


Handled = dict[tuple[str, date], set[str]]


def build_context(found: list[Occurrence], today: date, handled: Handled) -> dict[str, Any]:
    return {
        "today": today.isoformat(),
        "weekday": today.strftime("%A"),
        "events": [
            {
                "ref": f"e{i}",
                "title": o.title,
                "date": o.start_date.isoformat(),
                "weekday": o.start_date.strftime("%A"),
                "time": None if o.start_time is None else f"{o.start_time:%H:%M}–{o.end_time:%H:%M}",
                "last_day": o.end_date.isoformat() if o.end_date != o.start_date else None,
                "days_until": (o.start_date - today).days,
                "repeats": o.recurrence,
                "location": o.location,
                "notes": o.notes[:300],
                "already_handled": sorted(handled.get((str(o.id), o.occurrence_date), set())),
            }
            for i, o in enumerate(found)
        ],
    }


def check_suggestions(raw: list[ClaudeSuggestion], found: list[Occurrence], today: date, handled: Handled) -> SuggestResult:
    """Keeps only sensible suggestions: known events, dates between today and the event, no repeats."""
    by_ref = {f"e{i}": o for i, o in enumerate(found)}
    seen: Handled = {}
    suggestions: list[Suggestion] = []
    warnings: list[str] = []
    for s in raw:
        o = by_ref.get(s.event_ref)
        title = " ".join(s.title.split())[:200]
        if o is None:
            warnings.append("Ignored a suggestion for an unknown event.")
            continue
        if not title:
            continue
        key = (str(o.id), o.occurrence_date)
        normalized = title_key(title)
        if normalized in handled.get(key, set()) or normalized in seen.get(key, set()):
            continue
        if len(seen.get(key, set())) == PER_EVENT:
            continue
        if len(suggestions) == MAX_SUGGESTIONS:
            warnings.append(f"Only the first {MAX_SUGGESTIONS} suggestions were kept.")
            break
        seen.setdefault(key, set()).add(normalized)
        event_day = o.start_date
        planned = min(event_day, max(today, event_day - timedelta(days=max(0, s.days_before))))
        duration = s.duration_min if s.duration_min and 1 <= s.duration_min <= 1440 else None
        suggestions.append(
            Suggestion(
                event_id=o.id,
                occurrence_date=o.occurrence_date,
                event_title=o.title,
                event_color=o.color,
                title=title,
                planned_date=planned,
                deadline=event_day if s.deadline_is_event and planned < event_day else None,
                duration_min=duration,
                priority=s.priority,
                fixed_day=planned == event_day,
                reason=" ".join(s.reason.split())[:200],
            )
        )
    suggestions.sort(key=lambda s: (s.planned_date, s.occurrence_date, s.title))
    return SuggestResult(suggestions=suggestions, events=len(found), warnings=warnings)


def load_handled(db: Supabase, start: date, end: date) -> Handled:
    rows = db.rest(
        "GET",
        LINKS,
        params={
            "select": "event_id,occurrence_date,title_key",
            "and": f"(occurrence_date.gte.{start},occurrence_date.lte.{end})",
        },
    )
    handled: Handled = {}
    for r in rows:
        handled.setdefault((r["event_id"], date.fromisoformat(r["occurrence_date"])), set()).add(r["title_key"])
    return handled


@router.post("/suggest", response_model=SuggestResult)
def suggest_tasks(body: SuggestRequest, db: SupabaseDep, claude: ClaudeDep) -> SuggestResult:
    """Asks Claude which tasks the events of the next 30 days call for. Saves nothing."""
    today = body.today or date.today()
    end = today + timedelta(days=HORIZON_DAYS)
    # Events still running today count, but only ones that start from today on can be prepared for.
    found = [o for o in load_occurrences(db, today, end) if o.start_date >= today]
    if not found:
        return SuggestResult(suggestions=[], events=0, warnings=[])
    handled = load_handled(db, today, end)
    raw = ask_structured(
        claude,
        system=SYSTEM_PROMPT,
        content=json.dumps(build_context(found, today, handled), ensure_ascii=False),
        schema=SCHEMA,
        model=ClaudeSuggestions,
        effort="low",
        what="task suggestions",
        max_tokens=8000,
    )
    return check_suggestions(raw.suggestions, found, today, handled)


@router.post("/suggest/apply", response_model=ApplyResult)
def apply_suggestions(body: ApplyRequest, db: SupabaseDep) -> ApplyResult:
    """Creates the accepted tasks (linked to their event) and remembers dismissed suggestions."""
    today = body.today or date.today()
    if any(a.planned_date < today for a in body.accepted):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Tasks can't be planned in the past.")
    created = 0
    for a in body.accepted:
        task = db.rest(
            "POST",
            TASKS,
            params={"select": "id"},
            json={
                "title": a.title,
                "planned_date": a.planned_date.isoformat(),
                "deadline": a.deadline.isoformat() if a.deadline and a.deadline >= a.planned_date else None,
                "duration_min": a.duration_min,
                "priority": a.priority,
                "fixed_day": a.fixed_day,
                "source_event_id": str(a.event_id),
                "source_occurrence_date": a.occurrence_date.isoformat(),
            },
        )[0]
        _remember(db, a.event_id, a.occurrence_date, a.suggested_title, "accepted", task["id"])
        created += 1
    for d in body.dismissed:
        _remember(db, d.event_id, d.occurrence_date, d.suggested_title, "dismissed", None)
    return ApplyResult(created=created, dismissed=len(body.dismissed))


def _remember(db: Supabase, event_id: UUID, occurrence: date, title: str, state: str, task_id: str | None) -> None:
    db.rest(
        "POST",
        LINKS,
        params={"on_conflict": "event_id,occurrence_date,title_key"},
        json={
            "event_id": str(event_id),
            "occurrence_date": occurrence.isoformat(),
            "title_key": title_key(title) or "task",
            "status": state,
            "task_id": task_id,
        },
        prefer="resolution=merge-duplicates,return=minimal",
    )
