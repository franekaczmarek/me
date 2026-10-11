"""Calendar events: expanding repeating events into occurrences, and time they take. Pure functions."""

import calendar
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from typing import Literal

Recurrence = Literal["none", "weekly", "monthly", "yearly"]


@dataclass(frozen=True)
class EventSpan:
    """The dates and times of an event (or of one of its occurrences)."""

    start_date: date
    end_date: date
    start_time: time | None = None
    end_time: time | None = None
    recurrence: Recurrence = "none"
    recurrence_until: date | None = None

    @property
    def all_day(self) -> bool:
        return self.start_time is None


def add_months(day: date, months: int) -> date:
    """Same day `months` later; the 31st becomes the last day of a shorter month (Feb 29 → Feb 28)."""
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _nth_start(base: date, recurrence: Recurrence, n: int) -> date:
    if recurrence == "weekly":
        return base + timedelta(weeks=n)
    if recurrence == "monthly":
        return add_months(base, n)
    return add_months(base, 12 * n)  # yearly


def _first_index(base: date, recurrence: Recurrence, earliest: date) -> int:
    """A safe (not too late) first occurrence index whose start may reach `earliest`."""
    if earliest <= base:
        return 0
    if recurrence == "weekly":
        return (earliest - base).days // 7
    months = (earliest.year - base.year) * 12 + earliest.month - base.month - 1
    return max(0, months if recurrence == "monthly" else months // 12)


def occurrences(event: EventSpan, start: date, end: date) -> list[EventSpan]:
    """Occurrences of `event` that overlap [start, end] (inclusive), in date order."""
    if end < start:
        return []
    length = event.end_date - event.start_date
    if event.recurrence == "none":
        return [event] if event.start_date <= end and event.end_date >= start else []

    last_start = min(end, event.recurrence_until or end)
    found = []
    n = _first_index(event.start_date, event.recurrence, start - length)
    while (first := _nth_start(event.start_date, event.recurrence, n)) <= last_start:
        if first + length >= start:
            found.append(replace(event, start_date=first, end_date=first + length))
        n += 1
    return found


def minutes_on(event: EventSpan, day: date) -> int:
    """Minutes a timed occurrence takes on `day`; all-day events don't block time."""
    if event.start_time is None or event.end_time is None:
        return 0
    starts = datetime.combine(event.start_date, event.start_time)
    ends = datetime.combine(event.end_date, event.end_time)
    day_start = datetime.combine(day, time())
    overlap = min(ends, day_start + timedelta(days=1)) - max(starts, day_start)
    return max(0, int(overlap.total_seconds() // 60))
