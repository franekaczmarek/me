"""Claude planning agent: proposes which day each movable task should go to. Nothing changes until the
user applies (a subset of) the proposal.

Pure parts (`build_context`, `check_proposal`) are separate from the API call so they can be tested alone.
"""

import json
import logging
from datetime import date, timedelta
from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ValidationError

from app.calendar.capacity import DayOff, WorkSchedule, capacity_minutes, is_work_day
from app.calendar.router import load_days_off, load_schedule
from app.core.config import get_settings
from app.core.supabase import Supabase, SupabaseDep
from app.todo.schemas import TASK_COLUMNS, Task

router = APIRouter(prefix="/todo", tags=["todo"])
logger = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
# Server-side fallback: if a safety classifier declines, the API retries on Anthropic's recommended model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
#: Assumed length of a task without an estimate.
DEFAULT_MINUTES = 30
TASKS = "todo_tasks"

SYSTEM_PROMPT = """You plan the coming days of one person's to-do list.

You get the days (date, weekday, whether it is a work day, minutes available for tasks, minutes already
booked by tasks that can't move) and the movable tasks (inbox tasks without a day, overdue tasks, and tasks
already planned in the period). For every movable task, choose a day from the given days, or null to leave
it in the inbox.

Plan the way a thoughtful assistant would:
- Keep each day's total within its available minutes. Tasks without an estimate take about 30 minutes.
- Put tasks with a deadline on or before it, the nearest deadlines first. Overdue tasks deserve an early slot.
- Schedule high priority before normal before low; it is fine to leave low-priority tasks in the inbox when
  the days are full.
- Spread the load: don't pack one day while the next is empty, and keep lighter loads on work days.
- Keep a task on its current day unless moving it clearly helps.
- List the tasks of each day in the order they should be done.

Give each task a short reason (at most 15 words). The summary is one or two friendly sentences about the plan.
Write in English."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "date": {"anyOf": [{"type": "string", "format": "date"}, {"type": "null"}]},
                    "reason": {"type": "string"},
                },
                "required": ["task_id", "date", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "assignments"],
    "additionalProperties": False,
}


# --- models ---------------------------------------------------------------------------------


class PlanRequest(BaseModel):
    today: date | None = None
    days: Annotated[int, Field(ge=1, le=14)] = 7


class Assignment(BaseModel):
    task_id: str
    date: date | None
    reason: str = ""


class ClaudePlan(BaseModel):
    summary: str
    assignments: list[Assignment]


class Change(BaseModel):
    task_id: UUID
    title: str
    from_date: date | None
    to_date: date | None
    #: 0-based order within the target day.
    order: int
    duration_min: int | None
    reason: str


class DayLoad(BaseModel):
    date: date
    capacity_min: int
    planned_min: int


class Proposal(BaseModel):
    summary: str
    changes: list[Change]
    warnings: list[str]
    days: list[DayLoad]


class ApplyChange(BaseModel):
    task_id: UUID
    to_date: date | None
    order: Annotated[int, Field(ge=0)] = 0


class ApplyRequest(BaseModel):
    today: date | None = None
    changes: Annotated[list[ApplyChange], Field(max_length=200)]


class ApplyResult(BaseModel):
    applied: int


# --- pure logic -----------------------------------------------------------------------------


def window(today: date, days: int) -> list[date]:
    return [today + timedelta(n) for n in range(days)]


def is_movable(task: Task, last: date) -> bool:
    """Open, not tied to its day, not a routine occurrence, and in the inbox, overdue or in the window."""
    if task.status != "open" or task.fixed_day or task.routine_id:
        return False
    return task.planned_date is None or task.planned_date <= last


def build_context(
    tasks: list[Task], today: date, days: int, schedule: WorkSchedule, days_off: list[DayOff]
) -> dict[str, Any]:
    dates = window(today, days)
    movable = [t for t in tasks if is_movable(t, dates[-1])]
    movable_ids = {t.id for t in movable}
    booked = {d: 0 for d in dates}
    for t in tasks:
        if t.id not in movable_ids and t.status != "missed" and t.planned_date in booked:
            booked[t.planned_date] += t.duration_min or DEFAULT_MINUTES
    return {
        "today": today.isoformat(),
        "days": [
            {
                "date": d.isoformat(),
                "weekday": d.strftime("%A"),
                "work_day": is_work_day(d, schedule, days_off),
                "available_min": capacity_minutes(d, schedule, days_off),
                "booked_min": booked[d],
            }
            for d in dates
        ],
        "tasks": [
            {
                "task_id": str(t.id),
                "title": t.title,
                "notes": t.notes[:300],
                "duration_min": t.duration_min,
                "priority": t.priority,
                "deadline": t.deadline.isoformat() if t.deadline else None,
                "current_day": t.planned_date.isoformat() if t.planned_date else None,
                "overdue": bool(t.planned_date and t.planned_date < today),
                "postponed_count": t.postponed_count,
            }
            for t in movable
        ],
    }


def check_proposal(plan: ClaudePlan, context: dict[str, Any], tasks: list[Task]) -> Proposal:
    """Keeps only valid changes and reports problems; never trusts the model blindly."""
    by_id = {str(t.id): t for t in tasks}
    movable = {t["task_id"] for t in context["tasks"]}
    days = {date.fromisoformat(d["date"]): d for d in context["days"]}
    warnings: list[str] = []
    final_day: dict[str, date | None] = {
        t["task_id"]: date.fromisoformat(t["current_day"]) if t["current_day"] else None for t in context["tasks"]
    }
    reasons: dict[str, str] = {}
    order: dict[str, int] = {}
    seen: set[str] = set()
    per_day_count: dict[date | None, int] = {}

    for a in plan.assignments:
        if a.task_id not in movable:
            warnings.append(f"Ignored a suggestion for a task that can't be moved ({a.task_id}).")
            continue
        if a.task_id in seen:
            continue
        seen.add(a.task_id)
        if a.date is not None and a.date not in days:
            warnings.append(f"Ignored “{by_id[a.task_id].title}”: {a.date} is outside the planned days.")
            continue
        final_day[a.task_id] = a.date
        reasons[a.task_id] = a.reason.strip()
        order[a.task_id] = per_day_count.get(a.date, 0)
        per_day_count[a.date] = order[a.task_id] + 1

    changes = []
    for task_id, to_day in final_day.items():
        task = by_id[task_id]
        if task_id not in reasons or to_day == task.planned_date:
            continue
        # Only deadlines that can still be met: a passed one can't be helped by any plan.
        today = date.fromisoformat(context["today"])
        if task.deadline and to_day and task.deadline >= today and to_day > task.deadline:
            warnings.append(f"“{task.title}” lands after its deadline ({task.deadline}).")
        changes.append(
            Change(
                task_id=task.id,
                title=task.title,
                from_date=task.planned_date,
                to_date=to_day,
                order=order[task_id],
                duration_min=task.duration_min,
                reason=reasons[task_id],
            )
        )

    loads = []
    for day, info in days.items():
        planned = info["booked_min"] + sum(
            by_id[tid].duration_min or DEFAULT_MINUTES for tid, d in final_day.items() if d == day
        )
        loads.append(DayLoad(date=day, capacity_min=info["available_min"], planned_min=planned))
        if planned > info["available_min"]:
            warnings.append(f"{day:%A} {day.day} {day:%B} is over its available time ({planned} of {info['available_min']} min).")

    changes.sort(key=lambda c: (c.to_date or date.max, c.order))
    return Proposal(summary=plan.summary.strip(), changes=changes, warnings=warnings, days=loads)


# --- Claude ---------------------------------------------------------------------------------


@lru_cache
def _client(api_key: str, workspace_id: str) -> anthropic.Anthropic:
    headers = {"anthropic-workspace-id": workspace_id} if workspace_id else None
    return anthropic.Anthropic(api_key=api_key, timeout=180, max_retries=2, default_headers=headers)


def get_claude() -> anthropic.Anthropic:
    """The Claude client; 503 when no API key is configured. Overridden in tests."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Planning with Claude isn't set up (no API key).")
    return _client(settings.anthropic_api_key, settings.anthropic_workspace_id)


ClaudeDep = Annotated[anthropic.Anthropic, Depends(get_claude)]


def ask_claude(client: anthropic.Anthropic, context: dict[str, Any]) -> ClaudePlan:
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(context, ensure_ascii=False)}],
        )
    except anthropic.AuthenticationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The Claude API key was rejected.") from exc
    except anthropic.RateLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Claude is busy right now; try again in a minute.") from exc
    except anthropic.APIStatusError as exc:
        logger.error("Claude API error %s (request %s): %s", exc.status_code, exc.request_id, exc.message)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Claude couldn't make a plan right now.") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Can't reach Claude right now.") from exc

    if response.stop_reason == "refusal":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Claude declined to plan these tasks.")
    if response.stop_reason == "max_tokens":
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The plan came back incomplete; try fewer days.")
    text = "".join(block.text for block in response.content if block.type == "text")
    try:
        return ClaudePlan.model_validate_json(text)
    except ValidationError as exc:
        logger.error("Unexpected planner output (request %s): %s", response._request_id, exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Claude's plan couldn't be read.") from exc


# --- routes ---------------------------------------------------------------------------------


def _load_tasks(db: Supabase, last: date) -> list[Task]:
    rows = db.rest(
        "GET",
        TASKS,
        params={
            "select": TASK_COLUMNS,
            "status": "neq.missed",
            "or": f"(planned_date.is.null,planned_date.lte.{last})",
        },
    )
    return [Task(**r) for r in rows]


@router.post("/plan", response_model=Proposal)
def propose_plan(body: PlanRequest, db: SupabaseDep, claude: ClaudeDep) -> Proposal:
    """Asks Claude for a plan of the next `days` days. Nothing is changed."""
    today = body.today or date.today()
    last = today + timedelta(body.days - 1)
    tasks = _load_tasks(db, last)
    context = build_context(tasks, today, body.days, load_schedule(db).to_capacity(), load_days_off(db, today, last))
    if not context["tasks"]:
        return Proposal(summary="Nothing to plan: there are no movable tasks.", changes=[], warnings=[], days=[])
    return check_proposal(ask_claude(claude, context), context, tasks)


@router.post("/plan/apply", response_model=ApplyResult)
def apply_plan(body: ApplyRequest, db: SupabaseDep) -> ApplyResult:
    """Applies the changes the user accepted (each one is a normal move of the task)."""
    today = body.today or date.today()
    if any(c.to_date and c.to_date < today for c in body.changes):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Tasks can't be planned in the past.")
    applied = 0
    for change in body.changes:
        rows = db.rest(
            "PATCH",
            TASKS,
            # Only tasks the planner may move: open, not fixed to a day, not a routine occurrence.
            params={
                "id": f"eq.{change.task_id}",
                "status": "eq.open",
                "fixed_day": "eq.false",
                "routine_id": "is.null",
                "select": "id",
            },
            json={"planned_date": change.to_date.isoformat() if change.to_date else None, "position": change.order},
        )
        applied += len(rows)
    return ApplyResult(applied=applied)
