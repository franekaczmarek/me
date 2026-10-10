"""Request/response models for the timeline API and their mapping to DB rows."""

from datetime import date, datetime
from typing import Annotated, Any, Self
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from app.timeline.dates import format_partial_date, parse_partial_date


def _normalize_partial_date(value: str) -> str:
    return format_partial_date(*parse_partial_date(value))


PartialDate = Annotated[
    str,
    AfterValidator(_normalize_partial_date),
    Field(description="YYYY, YYYY-MM or YYYY-MM-DD", examples=["2015", "2015-06", "2015-06-17"]),
]
CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Color = Annotated[str, StringConstraints(to_lower=True, pattern=r"^#[0-9a-fA-F]{6}$")]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, StringConstraints(max_length=20000)]


def _reject_explicit_nulls(model: BaseModel, fields: tuple[str, ...]) -> None:
    for name in fields:
        if name in model.model_fields_set and getattr(model, name) is None:
            raise ValueError(f"{name} cannot be null")


def _check_order(start: str | None, end: str | None) -> None:
    if start and end and parse_partial_date(end)[0] < parse_partial_date(start)[0]:
        raise ValueError("end must not be before start")


# --- categories --------------------------------------------------------------


class CategoryCreate(BaseModel):
    name: CategoryName
    color: Color


class CategoryUpdate(BaseModel):
    name: CategoryName | None = None
    color: Color | None = None

    @model_validator(mode="after")
    def _no_nulls(self) -> Self:
        _reject_explicit_nulls(self, ("name", "color"))
        return self


class Category(BaseModel):
    id: UUID
    name: str
    color: str


CATEGORY_COLUMNS = "id,name,color"


# --- events --------------------------------------------------------------------


class EventCreate(BaseModel):
    title: Title
    description: Description = ""
    start: PartialDate
    end: PartialDate | None = Field(None, description="Set for periods; omit for single points")
    category_id: UUID | None = None

    @model_validator(mode="after")
    def _end_after_start(self) -> Self:
        _check_order(self.start, self.end)
        return self

    def to_row(self) -> dict[str, Any]:
        return _event_row(self.model_dump())


class EventUpdate(BaseModel):
    """Partial update: only fields present in the request are changed. `end: null` makes a point."""

    title: Title | None = None
    description: Description | None = None
    start: PartialDate | None = None
    end: PartialDate | None = None
    category_id: UUID | None = None

    @model_validator(mode="after")
    def _validate(self) -> Self:
        _reject_explicit_nulls(self, ("title", "description", "start"))
        # Only checkable when both are sent; otherwise the DB constraint decides.
        _check_order(self.start, self.end)
        return self

    def to_row(self) -> dict[str, Any]:
        return _event_row(self.model_dump(exclude_unset=True))


class Event(BaseModel):
    id: UUID
    title: str
    description: str
    start: str
    end: str | None
    category_id: UUID | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Self:
        return cls(
            id=row["id"],
            title=row["title"],
            description=row["description"],
            start=format_partial_date(date.fromisoformat(row["start_date"]), row["start_precision"]),
            end=(
                format_partial_date(date.fromisoformat(row["end_date"]), row["end_precision"])
                if row["end_date"]
                else None
            ),
            category_id=row["category_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


EVENT_COLUMNS = (
    "id,title,description,start_date,start_precision,end_date,end_precision,category_id,created_at,updated_at"
)


def _event_row(data: dict[str, Any]) -> dict[str, Any]:
    """Map API fields to columns: start/end strings become date + precision pairs."""
    row: dict[str, Any] = {}
    for key, value in data.items():
        if key in ("start", "end"):
            if value is None:
                row[f"{key}_date"] = row[f"{key}_precision"] = None
            else:
                day, precision = parse_partial_date(value)
                row[f"{key}_date"], row[f"{key}_precision"] = day.isoformat(), precision
        elif key == "category_id":
            row[key] = str(value) if value else None
        else:
            row[key] = value
    return row
