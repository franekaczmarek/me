"""Work schedule and how much time a day leaves for tasks."""

from dataclasses import dataclass
from datetime import date, time


@dataclass(frozen=True)
class WorkSchedule:
    # ISO weekdays, 1 = Monday … 7 = Sunday.
    work_days: tuple[int, ...] = (1, 2, 3, 4, 5)
    work_start: time = time(9)
    work_end: time = time(17)
    task_minutes_workday: int = 180
    task_minutes_day_off: int = 360


DEFAULT_SCHEDULE = WorkSchedule()


@dataclass(frozen=True)
class DayOff:
    start: date
    end: date
    label: str = ""


def is_work_day(day: date, schedule: WorkSchedule, days_off: list[DayOff]) -> bool:
    if any(off.start <= day <= off.end for off in days_off):
        return False
    return day.isoweekday() in schedule.work_days


def capacity_minutes(day: date, schedule: WorkSchedule, days_off: list[DayOff]) -> int:
    """Minutes the user wants to spend on tasks that day."""
    if is_work_day(day, schedule, days_off):
        return schedule.task_minutes_workday
    return schedule.task_minutes_day_off
