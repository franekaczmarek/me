from datetime import date

from app.calendar.capacity import DEFAULT_SCHEDULE, DayOff, WorkSchedule, capacity_minutes, is_work_day

MONDAY = date(2026, 3, 2)
SATURDAY = date(2026, 3, 7)


def test_default_schedule_works_monday_to_friday() -> None:
    assert is_work_day(MONDAY, DEFAULT_SCHEDULE, [])
    assert not is_work_day(SATURDAY, DEFAULT_SCHEDULE, [])
    assert capacity_minutes(MONDAY, DEFAULT_SCHEDULE, []) == 180
    assert capacity_minutes(SATURDAY, DEFAULT_SCHEDULE, []) == 360


def test_days_off_count_as_free_days() -> None:
    vacation = [DayOff(date(2026, 3, 2), date(2026, 3, 4), "Vacation")]
    assert not is_work_day(MONDAY, DEFAULT_SCHEDULE, vacation)
    assert capacity_minutes(date(2026, 3, 4), DEFAULT_SCHEDULE, vacation) == 360
    assert capacity_minutes(date(2026, 3, 5), DEFAULT_SCHEDULE, vacation) == 180


def test_custom_schedule() -> None:
    schedule = WorkSchedule(work_days=(1, 2, 3, 4, 5, 6), task_minutes_workday=60, task_minutes_day_off=0)
    assert capacity_minutes(SATURDAY, schedule, []) == 60
    assert capacity_minutes(date(2026, 3, 8), schedule, []) == 0


def test_event_minutes_depend_on_the_day() -> None:
    from datetime import time

    from app.calendar.capacity import DEFAULT_SCHEDULE, DayOff, event_minutes
    from app.calendar.events import EventSpan

    monday, saturday = date(2026, 10, 12), date(2026, 10, 17)
    visit = [EventSpan(monday, monday, time(16), time(18))]
    assert event_minutes(monday, visit, DEFAULT_SCHEDULE, []) == 60
    assert event_minutes(monday, visit, DEFAULT_SCHEDULE, [DayOff(monday, monday)]) == 120
    party = [EventSpan(saturday, saturday, time(16), time(18))]
    assert event_minutes(saturday, party, DEFAULT_SCHEDULE, []) == 120
