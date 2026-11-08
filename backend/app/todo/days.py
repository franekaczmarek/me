"""Which days the to-do list shows, and what is on them. Pure functions."""

from datetime import date, timedelta

from app.calendar.capacity import DayOff, WorkSchedule, capacity_minutes, event_minutes, is_work_day
from app.calendar.schemas import Occurrence
from app.todo.schemas import Day, EventChip, Task

#: Always shown after today.
WEEK_AHEAD = 6
#: Further days are shown only when something is planned on them.
HORIZON = 13
#: Undone routine occurrences stay on their past day this long, then they count as missed.
PAST_DAYS = 7

_PRIORITY = {"high": 0, "normal": 1, "low": 2}


def window_end(today: date) -> date:
    return today + timedelta(days=HORIZON)


def missed_before(today: date) -> date:
    """Undone routine occurrences planned before this day are missed."""
    return today - timedelta(days=PAST_DAYS)


def _day_order(task: Task) -> tuple:
    return (task.position, _PRIORITY[task.priority], task.created_at)


def inbox_order(task: Task) -> tuple:
    """Most urgent first: nearest deadline, then priority, then oldest."""
    return (task.deadline or date.max, _PRIORITY[task.priority], task.created_at)


def _on(events: list[Occurrence], day: date) -> list[Occurrence]:
    return [o for o in events if o.start_date <= day <= o.end_date]


def build_days(
    tasks: list[Task],
    today: date,
    schedule: WorkSchedule,
    days_off: list[DayOff],
    events: list[Occurrence] | None = None,
) -> tuple[list[Day], list[Task]]:
    """Overdue days (oldest first), today, the next 6 days, then later days up to 2 weeks that have tasks.

    Missed routine occurrences are not shown. A past day is shown while it has an undone task, together with
    the tasks already done on it (ticked off late, they still count on that day). Calendar events show on
    their days (already sorted: all-day first, then by time) and take away task time.
    """
    events = events or []
    by_day: dict[date, list[Task]] = {}
    inbox: list[Task] = []
    for task in tasks:
        if task.status == "missed":
            continue
        if task.planned_date is None:
            if task.status == "open":
                inbox.append(task)
        elif task.planned_date < today:
            by_day.setdefault(task.planned_date, []).append(task)
        elif task.planned_date <= window_end(today):
            by_day.setdefault(task.planned_date, []).append(task)

    shown = sorted(d for d in by_day if d < today and any(t.status == "open" for t in by_day[d]))
    shown += [today + timedelta(days=n) for n in range(WEEK_AHEAD + 1)]
    shown += sorted(d for d in by_day if d > today + timedelta(days=WEEK_AHEAD))

    days = [
        Day(
            date=day,
            is_today=day == today,
            is_overdue=day < today,
            is_work_day=is_work_day(day, schedule, days_off),
            capacity_min=capacity_minutes(day, schedule, days_off),
            planned_min=sum(t.duration_min or 0 for t in by_day.get(day, [])),
            event_min=event_minutes(day, [o.span() for o in _on(events, day)], schedule, days_off),
            events=[EventChip(**o.model_dump(include=set(EventChip.model_fields))) for o in _on(events, day)],
            tasks=sorted(by_day.get(day, []), key=_day_order),
        )
        for day in shown
    ]
    return days, sorted(inbox, key=inbox_order)
