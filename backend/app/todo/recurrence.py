"""Occurrence dates of recurring routines."""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Kind = Literal["daily", "weekdays", "weekly", "interval", "monthly"]


@dataclass(frozen=True)
class Rule:
    kind: Kind
    starts_on: date
    # ISO weekdays, 1 = Monday … 7 = Sunday (weekly).
    weekdays: tuple[int, ...] = ()
    interval_days: int | None = None
    month_day: int | None = None


def occurs_on(rule: Rule, day: date) -> bool:
    if day < rule.starts_on:
        return False
    if rule.kind == "daily":
        return True
    if rule.kind == "weekdays":
        return day.isoweekday() <= 5
    if rule.kind == "weekly":
        return day.isoweekday() in rule.weekdays
    if rule.kind == "interval":
        return (day - rule.starts_on).days % (rule.interval_days or 1) == 0
    # Monthly: a day the month doesn't have (e.g. 31) falls on its last day.
    last = calendar.monthrange(day.year, day.month)[1]
    return day.day == min(rule.month_day or 1, last)


def occurrences(rule: Rule, start: date, end: date) -> list[date]:
    """Occurrence dates from start to end, both inclusive."""
    days = (end - start).days + 1
    return [d for d in (start + timedelta(n) for n in range(max(days, 0))) if occurs_on(rule, d)]
