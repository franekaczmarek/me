from datetime import date

import pytest

from app.timeline.dates import format_partial_date, parse_partial_date


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2015", (date(2015, 1, 1), "year")),
        ("2015-06", (date(2015, 6, 1), "month")),
        ("2015-06-17", (date(2015, 6, 17), "day")),
        (" 1931-02-28 ", (date(1931, 2, 28), "day")),
        ("2024-02-29", (date(2024, 2, 29), "day")),
        ("0800", (date(800, 1, 1), "year")),
    ],
)
def test_parses_partial_dates(text: str, expected: tuple) -> None:
    assert parse_partial_date(text) == expected


@pytest.mark.parametrize(
    "text",
    ["", "15", "2015-6", "2015-06-1", "2015/06/17", "17-06-2015", "2015-13", "2015-00", "2023-02-29", "0000", "abcd"],
)
def test_rejects_invalid_partial_dates(text: str) -> None:
    with pytest.raises(ValueError):
        parse_partial_date(text)


@pytest.mark.parametrize(
    ("value", "precision", "expected"),
    [
        (date(2015, 1, 1), "year", "2015"),
        (date(2015, 6, 1), "month", "2015-06"),
        (date(2015, 6, 17), "day", "2015-06-17"),
        (date(800, 1, 1), "year", "0800"),
    ],
)
def test_formats_partial_dates(value: date, precision: str, expected: str) -> None:
    assert format_partial_date(value, precision) == expected  # type: ignore[arg-type]


def test_format_and_parse_round_trip() -> None:
    for text in ("1999", "1999-12", "1999-12-31"):
        assert format_partial_date(*parse_partial_date(text)) == text
