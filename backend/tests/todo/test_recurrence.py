from datetime import date

import pytest

from app.todo.recurrence import Rule, occurrences, occurs_on

MONDAY = date(2026, 3, 2)


def dates(rule: Rule, start: date, end: date) -> list[str]:
    return [d.isoformat() for d in occurrences(rule, start, end)]


def test_daily() -> None:
    rule = Rule("daily", starts_on=MONDAY)
    assert dates(rule, date(2026, 3, 1), date(2026, 3, 4)) == ["2026-03-02", "2026-03-03", "2026-03-04"]


def test_weekdays_skip_the_weekend() -> None:
    rule = Rule("weekdays", starts_on=MONDAY)
    assert dates(rule, date(2026, 3, 6), date(2026, 3, 9)) == ["2026-03-06", "2026-03-09"]


def test_weekly_on_chosen_days() -> None:
    rule = Rule("weekly", starts_on=MONDAY, weekdays=(2, 7))  # Tuesday, Sunday
    assert dates(rule, MONDAY, date(2026, 3, 15)) == ["2026-03-03", "2026-03-08", "2026-03-10", "2026-03-15"]


def test_every_n_days_counts_from_the_start() -> None:
    rule = Rule("interval", starts_on=MONDAY, interval_days=3)
    assert dates(rule, date(2026, 3, 3), date(2026, 3, 12)) == ["2026-03-05", "2026-03-08", "2026-03-11"]


def test_monthly_falls_back_to_the_last_day() -> None:
    rule = Rule("monthly", starts_on=date(2026, 1, 1), month_day=31)
    assert dates(rule, date(2026, 1, 1), date(2026, 4, 30)) == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
    leap = Rule("monthly", starts_on=date(2028, 1, 1), month_day=30)
    assert occurs_on(leap, date(2028, 2, 29))


def test_nothing_before_the_start() -> None:
    rule = Rule("daily", starts_on=date(2026, 3, 10))
    assert dates(rule, MONDAY, date(2026, 3, 11)) == ["2026-03-10", "2026-03-11"]


@pytest.mark.parametrize("end", [date(2026, 3, 1), MONDAY])
def test_empty_or_single_day_ranges(end: date) -> None:
    rule = Rule("daily", starts_on=date(2026, 1, 1))
    assert len(occurrences(rule, MONDAY, end)) == (1 if end == MONDAY else 0)
