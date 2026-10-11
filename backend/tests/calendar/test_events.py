from datetime import date, time

import pytest

from app.calendar.events import EventSpan, add_months, minutes_on, occurrences


def starts(event: EventSpan, start: date, end: date) -> list[date]:
    return [o.start_date for o in occurrences(event, start, end)]


@pytest.mark.parametrize(
    ("day", "months", "expected"),
    [
        (date(2026, 1, 31), 1, date(2026, 2, 28)),
        (date(2024, 2, 29), 12, date(2025, 2, 28)),
        (date(2024, 2, 29), 48, date(2028, 2, 29)),
        (date(2026, 11, 15), 3, date(2027, 2, 15)),
        (date(2026, 3, 31), -1, date(2026, 2, 28)),
    ],
)
def test_add_months(day: date, months: int, expected: date) -> None:
    assert add_months(day, months) == expected


def test_single_event_overlapping_the_range() -> None:
    event = EventSpan(date(2026, 10, 30), date(2026, 11, 2))
    assert starts(event, date(2026, 11, 1), date(2026, 11, 30)) == [date(2026, 10, 30)]
    assert starts(event, date(2026, 11, 3), date(2026, 11, 30)) == []
    assert starts(event, date(2026, 10, 1), date(2026, 10, 29)) == []


def test_empty_range() -> None:
    assert occurrences(EventSpan(date(2026, 1, 1), date(2026, 1, 1)), date(2026, 2, 1), date(2026, 1, 1)) == []


def test_yearly_birthday_from_long_ago() -> None:
    birthday = EventSpan(date(1965, 3, 14), date(1965, 3, 14), recurrence="yearly")
    assert starts(birthday, date(2026, 1, 1), date(2027, 12, 31)) == [date(2026, 3, 14), date(2027, 3, 14)]
    assert starts(birthday, date(2026, 3, 15), date(2027, 3, 13)) == []


def test_yearly_on_leap_day_falls_back_to_feb_28() -> None:
    event = EventSpan(date(2024, 2, 29), date(2024, 2, 29), recurrence="yearly")
    assert starts(event, date(2025, 1, 1), date(2028, 12, 31)) == [
        date(2025, 2, 28),
        date(2026, 2, 28),
        date(2027, 2, 28),
        date(2028, 2, 29),
    ]


def test_monthly_on_the_31st_uses_the_last_day() -> None:
    event = EventSpan(date(2026, 1, 31), date(2026, 1, 31), recurrence="monthly")
    assert starts(event, date(2026, 2, 1), date(2026, 5, 31)) == [
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
        date(2026, 5, 31),
    ]


def test_weekly_until() -> None:
    event = EventSpan(date(2026, 10, 5), date(2026, 10, 5), time(18), time(19), "weekly", date(2026, 10, 26))
    assert starts(event, date(2026, 10, 1), date(2026, 12, 31)) == [
        date(2026, 10, 5),
        date(2026, 10, 12),
        date(2026, 10, 19),
        date(2026, 10, 26),
    ]
    assert starts(event, date(2026, 10, 13), date(2026, 10, 18)) == []


def test_repeating_multi_day_event_overlapping_the_range_start() -> None:
    trip = EventSpan(date(2026, 1, 30), date(2026, 2, 2), recurrence="monthly")
    found = occurrences(trip, date(2026, 3, 1), date(2026, 3, 31))
    assert [(o.start_date, o.end_date) for o in found] == [
        (date(2026, 2, 28), date(2026, 3, 3)),
        (date(2026, 3, 30), date(2026, 4, 2)),
    ]


def test_nothing_before_the_first_occurrence() -> None:
    event = EventSpan(date(2026, 10, 20), date(2026, 10, 20), recurrence="weekly")
    assert starts(event, date(2026, 10, 1), date(2026, 10, 19)) == []


def test_minutes_on() -> None:
    visit = EventSpan(date(2026, 10, 12), date(2026, 10, 12), time(15, 30), time(17))
    assert minutes_on(visit, date(2026, 10, 12)) == 90
    assert minutes_on(visit, date(2026, 10, 13)) == 0

    overnight = EventSpan(date(2026, 10, 12), date(2026, 10, 13), time(22), time(2))
    assert minutes_on(overnight, date(2026, 10, 12)) == 120
    assert minutes_on(overnight, date(2026, 10, 13)) == 120

    assert minutes_on(EventSpan(date(2026, 10, 12), date(2026, 10, 12)), date(2026, 10, 12)) == 0
