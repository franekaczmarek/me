"""Quick add: Claude turns free text ("dentist tomorrow 30 min, important; call mum on Friday") into
task drafts. Nothing is saved here; the client shows a preview and creates the accepted tasks with
`POST /todo/tasks`.
"""

import json
from datetime import date, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints

from app.core.claude import ClaudeDep, ask_structured

router = APIRouter(prefix="/todo", tags=["todo"])

MAX_TASKS = 20
#: Days listed for Claude so weekday names ("on Friday", "w piątek") resolve to dates.
CALENDAR_DAYS = 21

SYSTEM_PROMPT = """You turn a short note into to-do tasks for a personal to-do app.

The user writes in Polish or English, often several tasks at once (separated by commas, semicolons,
"and"/"i", or new lines). Return one task per thing to do.

For each task:
- title: short and clear, in the user's language; drop the date, time and priority words from it.
- planned_date: the day the user wants to do it ("today", "tomorrow"/"jutro", a weekday = the nearest
  such day from today on, "next week" = next Monday). Use only dates from the given calendar.
  null when no day is mentioned — the task goes to the inbox.
- deadline: only when the user says "by"/"until"/"do"/"najpóźniej" a date; otherwise null.
- duration_min: minutes if the user gives a length; otherwise your realistic estimate, with
  duration_estimated true. Use null only if you can't guess at all.
- priority: "high" for urgent/important/ważne/pilne, "low" for someday/kiedyś/no rush, else "normal".
- fixed_day: true only for appointments or things that must happen on that exact day (a visit at a set
  time, a birthday, a meeting); false otherwise.
- notes: any extra detail worth keeping, such as a time of day ("at 15:00"); otherwise "".

Never invent tasks the note doesn't mention."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "planned_date": {"anyOf": [{"type": "string", "format": "date"}, {"type": "null"}]},
                    "deadline": {"anyOf": [{"type": "string", "format": "date"}, {"type": "null"}]},
                    "duration_min": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "duration_estimated": {"type": "boolean"},
                    "priority": {"type": "string", "enum": ["low", "normal", "high"]},
                    "fixed_day": {"type": "boolean"},
                    "notes": {"type": "string"},
                },
                "required": [
                    "title",
                    "planned_date",
                    "deadline",
                    "duration_min",
                    "duration_estimated",
                    "priority",
                    "fixed_day",
                    "notes",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["tasks"],
    "additionalProperties": False,
}

Priority = Literal["low", "normal", "high"]


class ParseRequest(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    today: date | None = None


class Draft(BaseModel):
    """A task as Claude understood it (not saved)."""

    title: str
    planned_date: date | None = None
    deadline: date | None = None
    duration_min: int | None = None
    #: True when Claude guessed the duration rather than reading it from the text.
    duration_estimated: bool = False
    priority: Priority = "normal"
    fixed_day: bool = False
    notes: str = ""


class ClaudeDrafts(BaseModel):
    tasks: list[Draft]


class ParseResult(BaseModel):
    tasks: list[Draft]
    warnings: list[str]


def calendar_context(text: str, today: date) -> dict[str, Any]:
    return {
        "today": today.isoformat(),
        "calendar": [
            {"date": (today + timedelta(n)).isoformat(), "weekday": (today + timedelta(n)).strftime("%A")}
            for n in range(CALENDAR_DAYS)
        ],
        "note": text,
    }


def clean_drafts(drafts: list[Draft], today: date) -> ParseResult:
    """Makes Claude's drafts safe to create: valid lengths and ranges, nothing in the past."""
    tasks: list[Draft] = []
    warnings: list[str] = []
    for d in drafts:
        title = " ".join(d.title.split())[:200]
        if not title:
            continue
        if len(tasks) == MAX_TASKS:
            warnings.append(f"Only the first {MAX_TASKS} tasks were kept.")
            break
        planned, deadline = d.planned_date, d.deadline
        if planned and planned < today:
            warnings.append(f"“{title}” pointed to a past day; it was moved to today.")
            planned = today
        if deadline and deadline < today:
            warnings.append(f"“{title}” had a deadline in the past; it was dropped.")
            deadline = None
        if planned and deadline and deadline < planned:
            planned = deadline  # do it by the deadline
        duration = d.duration_min if d.duration_min and 1 <= d.duration_min <= 1440 else None
        tasks.append(
            Draft(
                title=title,
                planned_date=planned,
                deadline=deadline,
                duration_min=duration,
                duration_estimated=d.duration_estimated and duration is not None,
                priority=d.priority,
                fixed_day=d.fixed_day and planned is not None,
                notes=d.notes.strip()[:5000],
            )
        )
    return ParseResult(tasks=tasks, warnings=warnings)


@router.post("/parse", response_model=ParseResult)
def parse_tasks(body: ParseRequest, claude: ClaudeDep) -> ParseResult:
    """Reads free text into task drafts for a preview. Saves nothing."""
    today = body.today or date.today()
    drafts = ask_structured(
        claude,
        system=SYSTEM_PROMPT,
        content=json.dumps(calendar_context(body.text, today), ensure_ascii=False),
        schema=SCHEMA,
        model=ClaudeDrafts,
        effort="low",
        what="tasks from your note",
        max_tokens=8000,
    )
    return clean_drafts(drafts.tasks, today)
