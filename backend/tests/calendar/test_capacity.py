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
