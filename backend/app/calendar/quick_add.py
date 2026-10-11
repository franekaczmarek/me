"""Quick add for the calendar: Claude turns a note ("dentysta czwartek 15:30; urodziny Kasi 3 marca co roku")
into event drafts. Nothing is saved here; the client shows a preview and creates the accepted events with
`POST /calendar/events`.
"""

import json
from datetime import date, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints

from app.calendar.events import Recurrence
from app.core.claude import ClaudeDep, ask_structured
from app.todo.quick_add import calendar_context

router = APIRouter(prefix="/calendar", tags=["calendar"])

MAX_EVENTS = 10
#: Length of a timed event when the note gives only its start.
DEFAULT_LENGTH = timedelta(hours=1)

Kind = Literal["birthday", "appointment", "trip", "social", "work", "other"]
#: Event colour per kind, from the app palette.
KIND_COLORS: dict[str, str] = {
    "birthday": "#f27fb2",
    "appointment": "#56a8f5",
    "trip": "#4cc9a0",
    "social": "#9b87f5",
    "work": "#ffa36c",
    "other": "#3bbfc9",
}

SYSTEM_PROMPT = """You turn a short note into calendar events for a personal calendar app.

The user writes in Polish or English, sometimes several events at once (separated by commas, semicolons,
"and"/"i", or new lines). Return one event per thing that happens at a time or on a day.

For each event:
- title: short and clear, in the user's language; drop the date, time and repeat words from it.
- start_date / end_date: the day(s). A weekday means the nearest such day from today on ("next Friday" =
  the one after); a date without a year means its next occurrence. Use the given calendar for the
  coming weeks. end_date equals start_date unless the event lasts several days ("trip 16–20 Oct").
- start_time / end_time: "HH:MM" when a time is given, else null (an all-day event). If only the start
  is given, end_time is null.
- recurrence: "yearly" for birthdays, name days and anniversaries, "weekly"/"monthly" when the note says
  so ("every Monday", "co tydzień"), else "none". For a birthday use the next occurrence as the date.
- kind: birthday, appointment (doctor, office, service), trip, social (meetings with people, parties),
  work, or other.
- location: a place if mentioned, else "". notes: any extra detail worth keeping, else "".

Never invent events the note doesn't mention."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "start_date": {"type": "string", "format": "date"},
                    "end_date": {"type": "string", "format": "date"},
                    "start_time": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "end_time": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "recurrence": {"type": "string", "enum": ["none", "weekly", "monthly", "yearly"]},
                    "kind": {"type": "string", "enum": list(KIND_COLORS)},
                    "location": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "required": [
                    "title",
                    "start_date",
                    "end_date",
                    "start_time",
                    "end_time",
                    "recurrence",
                    "kind",
                    "location",
                    "notes",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["events"],
    "additionalProperties": False,
}


class ParseRequest(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    today: date | None = None


class ClaudeEvent(BaseModel):
    title: str
    start_date: date
    end_date: date
    start_time: str | None = None
    end_time: str | None = None
    recurrence: Recurrence = "none"
    kind: Kind = "other"
    location: str = ""
    notes: str = ""


class ClaudeEvents(BaseModel):
    events: list[ClaudeEvent]


class EventDraft(BaseModel):
    """An event as Claude understood it (not saved); fields match `POST /calendar/events`."""

    title: str
    start_date: date
    end_date: date
    start_time: time | None
    end_time: time | None
    recurrence: Recurrence
    color: str
    location: str
    notes: str


class ParseResult(BaseModel):
    events: list[EventDraft]
    warnings: list[str]


def _time(value: str | None) -> time | None:
    if not value:
        return None
    try:
        return time.fromisoformat(value.strip())
    except ValueError:
        return None


def clean_events(raw: list[ClaudeEvent]) -> ParseResult:
    """Makes Claude's drafts valid events: ordered dates, a start and end time or neither, sane lengths."""
    events: list[EventDraft] = []
    warnings: list[str] = []
    for e in raw:
        title = " ".join(e.title.split())[:200]
        if not title:
            continue
        if len(events) == MAX_EVENTS:
            warnings.append(f"Only the first {MAX_EVENTS} events were kept.")
            break
        end_date = max(e.start_date, e.end_date)
        start, end = _time(e.start_time), _time(e.end_time)
        if start is None:
            end = None
        else:
            starts = datetime.combine(e.start_date, start)
            ends = datetime.combine(end_date, end) if end else None
            if ends is None or ends <= starts:
                ends = starts + DEFAULT_LENGTH
            end_date, end = ends.date(), ends.time()
        events.append(
            EventDraft(
                title=title,
                start_date=e.start_date,
                end_date=end_date,
                start_time=start,
                end_time=end,
                recurrence=e.recurrence,
                color=KIND_COLORS[e.kind],
                location=" ".join(e.location.split())[:200],
                notes=e.notes.strip()[:5000],
            )
        )
    return ParseResult(events=events, warnings=warnings)


@router.post("/parse", response_model=ParseResult)
def parse_events(body: ParseRequest, claude: ClaudeDep) -> ParseResult:
    """Reads free text into event drafts for a preview. Saves nothing."""
    today = body.today or date.today()
    raw = ask_structured(
        claude,
        system=SYSTEM_PROMPT,
        content=json.dumps(calendar_context(body.text, today), ensure_ascii=False),
        schema=SCHEMA,
        model=ClaudeEvents,
        effort="low",
        what="events from your note",
        max_tokens=8000,
    )
    return clean_events(raw.events)
