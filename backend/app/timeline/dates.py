"""Partial dates: "2015" (year), "2015-06" (month) or "2015-06-17" (day).

The database stores a partial date as the first day of the period it describes
plus a precision: "2015" -> (2015-01-01, "year").
"""

import re
from datetime import date
from typing import Literal

Precision = Literal["year", "month", "day"]

_PATTERN = re.compile(r"(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?")


def parse_partial_date(value: str) -> tuple[date, Precision]:
    match = _PATTERN.fullmatch(value.strip())
    if not match:
        raise ValueError("Use YYYY, YYYY-MM or YYYY-MM-DD")
    year, month, day = match.groups()
    precision: Precision = "day" if day else "month" if month else "year"
    try:
        return date(int(year), int(month or 1), int(day or 1)), precision
    except ValueError:
        raise ValueError(f"Not a valid date: {value}") from None


def format_partial_date(value: date, precision: Precision) -> str:
    if precision == "year":
        return f"{value.year:04d}"
    if precision == "month":
        return f"{value.year:04d}-{value.month:02d}"
    return value.isoformat()
