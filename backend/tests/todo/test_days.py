from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from app.calendar.capacity import DEFAULT_SCHEDULE, DayOff
from app.todo.days import build_days
from app.todo.schemas import Task

TODAY = date(2026, 3, 4)  # Wednesday
CREATED = datetime(2026, 3, 1, tzinfo=UTC)


def task(title: str, planned: date | None = None, **fields) -> Task:
    data = {
        "id": uuid4(),
        "title": title,
        "notes": "",
        "planned_date": planned,
        "deadline": None,
        "duration_min": None,
        "priority": "normal",
        "fixed_day": False,
        "status": "open",
        "completed_at": None,
        "first_planned_date": planned,
        "postponed_count": 0,
        "routine_id": None,
        "occurrence_date": None,
        "position": 0,
        "created_at": CREATED,
    }
    return Task(**{**data, **fields})


def build(tasks: list[Task], days_off: list[DayOff] | None = None):
    return build_days(tasks, TODAY, DEFAULT_SCHEDULE, days_off or [])


def day_dates(days) -> list[date]:
    return [d.date for d in days]


def test_today_and_the_next_six_days_are_always_shown() -> None:
    days, inbox = build([])
    assert day_dates(days) == [TODAY + timedelta(n) for n in range(7)]
    assert [d.is_today for d in days] == [True] + [False] * 6
    assert inbox == []


def test_later_days_up_to_two_weeks_only_when_something_is_planned() -> None:
    days, _ = build([task("Dentist", TODAY + timedelta(10)), task("Too far", TODAY + timedelta(14))])
    assert day_dates(days)[-1] == TODAY + timedelta(10)
    assert len(days) == 8


def test_overdue_days_come_first_with_only_undone_tasks() -> None:
    days, _ = build(
        [
            task("Old undone", TODAY - timedelta(5)),
            task("Yesterday undone", TODAY - timedelta(1)),
            task("Yesterday done", TODAY - timedelta(1), status="done", completed_at=CREATED),
            task("Past done", TODAY - timedelta(3), status="done", completed_at=CREATED),
        ]
    )
    assert day_dates(days)[:3] == [TODAY - timedelta(5), TODAY - timedelta(1), TODAY]
    assert days[0].is_overdue and days[1].is_overdue and not days[2].is_overdue
    assert [t.title for t in days[1].tasks] == ["Yesterday undone"]


def test_done_tasks_stay_visible_today_and_later() -> None:
    days, _ = build([task("Done today", TODAY, status="done", completed_at=CREATED)])
    assert [t.title for t in days[0].tasks] == ["Done today"]


def test_missed_routine_occurrences_are_hidden() -> None:
    days, _ = build([task("Missed", TODAY - timedelta(1), status="missed"), task("Skipped", TODAY, status="missed")])
    assert days[0].date == TODAY
    assert days[0].tasks == []


def test_inbox_holds_open_undated_tasks_most_urgent_first() -> None:
    _, inbox = build(
        [
            task("Someday", priority="low"),
            task("Important", priority="high"),
            task("Due soon", deadline=TODAY + timedelta(2)),
            task("Due later", deadline=TODAY + timedelta(9)),
            task("Done", status="done", completed_at=CREATED),
        ]
    )
    assert [t.title for t in inbox] == ["Due soon", "Due later", "Important", "Someday"]


def test_planned_minutes_and_capacity() -> None:
    saturday = date(2026, 3, 7)
    days, _ = build([task("A", TODAY, duration_min=90), task("B", TODAY, duration_min=45), task("C", TODAY)])
    today = days[0]
    assert (today.planned_min, today.capacity_min, today.is_work_day) == (135, 180, True)
    weekend = next(d for d in days if d.date == saturday)
    assert (weekend.capacity_min, weekend.is_work_day) == (360, False)


def test_days_off_change_capacity() -> None:
    days, _ = build([], [DayOff(TODAY, TODAY, "Holiday")])
    assert (days[0].is_work_day, days[0].capacity_min) == (False, 360)


def test_tasks_in_a_day_follow_position_then_priority() -> None:
    days, _ = build(
        [
            task("Second", TODAY, position=1, priority="high"),
            task("First, low", TODAY, priority="low"),
            task("First, high", TODAY, priority="high"),
        ]
    )
    assert [t.title for t in days[0].tasks] == ["First, high", "First, low", "Second"]


def test_events_show_on_their_days_and_take_task_time() -> None:
    from datetime import time

    from app.calendar.schemas import Event, to_occurrence

    dinner = Event(
        id=uuid4(), title="Dinner", start_date=TODAY, end_date=TODAY, start_time=time(18), end_time=time(20)
    )
    trip = Event(id=uuid4(), title="Trip", start_date=TODAY + timedelta(1), end_date=TODAY + timedelta(2))
    events = [to_occurrence(e, e.span()) for e in (dinner, trip)]
    days, _ = build_days([], TODAY, DEFAULT_SCHEDULE, [], events)
    assert [(c.title, c.all_day) for c in days[0].events] == [("Dinner", False)]
    assert days[0].event_min == 120
    assert [c.title for c in days[1].events] == ["Trip"] and [c.title for c in days[2].events] == ["Trip"]
    assert days[1].event_min == 0
    assert days[3].events == []
