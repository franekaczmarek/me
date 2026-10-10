"""To-do statistics: done on time vs late, overdue, missed routines, streak. Pure functions."""

from datetime import date, timedelta

from pydantic import BaseModel

from app.todo.schemas import Task


class DayStats(BaseModel):
    date: date
    on_time: int
    late: int
    missed: int


class Stats(BaseModel):
    days: int
    done: int
    on_time: int
    late: int
    #: Open tasks whose day or deadline has passed (any age).
    overdue: int
    missed: int
    #: On time among everything that was due in the period (done, late, missed, overdue); null if nothing was.
    on_time_rate: float | None
    avg_postponed: float | None
    #: Consecutive days with tasks (back from today) where everything was done on time.
    streak: int
    last_week: list[DayStats]


def due_date(task: Task) -> date | None:
    return task.deadline or task.planned_date


def completed_on(task: Task) -> date | None:
    return task.completed_at.date() if task.completed_at else None


def is_on_time(task: Task) -> bool:
    due = due_date(task)
    done = completed_on(task)
    return done is not None and (due is None or done <= due)


def is_overdue(task: Task, today: date) -> bool:
    due = due_date(task)
    return task.status == "open" and due is not None and due < today


def _day_is_clean(tasks: list[Task], day: date, today: date) -> bool | None:
    """True if every task planned on `day` was done on time; None if nothing was planned."""
    planned = [t for t in tasks if t.planned_date == day]
    if not planned:
        return None
    if day == today:
        # Today counts only once everything is done; open tasks don't break the streak yet.
        return all(t.status == "done" and is_on_time(t) for t in planned) or None
    return all(t.status == "done" and is_on_time(t) for t in planned)


def compute_stats(tasks: list[Task], today: date, days: int = 30) -> Stats:
    start = today - timedelta(days=days - 1)
    done = [t for t in tasks if t.status == "done" and (completed_on(t) or today) >= start]
    on_time = [t for t in done if is_on_time(t)]
    late = [t for t in done if not is_on_time(t)]
    missed = [t for t in tasks if t.status == "missed" and t.planned_date and start <= t.planned_date <= today]
    overdue = [t for t in tasks if is_overdue(t, today)]

    due_total = len(done) + len(missed) + len(overdue)
    # Days with nothing planned (e.g. weekends) neither count nor break the streak.
    streak = 0
    day = today
    while day >= start and (clean := _day_is_clean(tasks, day, today)) is not False:
        streak += bool(clean)
        day -= timedelta(days=1)

    last_week = []
    for n in range(6, -1, -1):
        d = today - timedelta(days=n)
        last_week.append(
            DayStats(
                date=d,
                on_time=sum(1 for t in on_time if completed_on(t) == d),
                late=sum(1 for t in late if completed_on(t) == d),
                missed=sum(1 for t in missed if t.planned_date == d),
            )
        )

    return Stats(
        days=days,
        done=len(done),
        on_time=len(on_time),
        late=len(late),
        overdue=len(overdue),
        missed=len(missed),
        on_time_rate=round(len(on_time) / due_total, 3) if due_total else None,
        avg_postponed=round(sum(t.postponed_count for t in done) / len(done), 2) if done else None,
        streak=streak,
        last_week=last_week,
    )
