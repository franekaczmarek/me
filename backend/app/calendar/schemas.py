"""Request/response models for calendar events."""

from datetime import date, time
from typing import Annotated, Any, Self
from uuid import UUID

from pydantic import BaseModel, StringConstraints, model_validator

from app.calendar.events import EventSpan, Recurrence

EVENT_COLUMNS = (
    "id,title,notes,location,start_date,end_date,start_time,end_time,color,recurrence,recurrence_until,"
    "add_to_timeline,timeline_event_id"
)

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Color = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^#[0-9a-fA-F]{6}$")]


class EventIn(BaseModel):
    """A whole event. All-day when start_time and end_time are both null (end_date inclusive)."""

    title: Title
    notes: Annotated[str, StringConstraints(max_length=5000)] = ""
    location: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    start_date: date
    end_date: date
    start_time: time | None = None
    end_time: time | None = None
    color: Color = "#56a8f5"
    recurrence: Recurrence = "none"
    recurrence_until: date | None = None
    add_to_timeline: bool = False

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("Give both start_time and end_time, or neither for an all-day event")
        if (
            self.start_time is not None
            and self.end_time is not None
            and self.end_date == self.start_date
            and self.end_time <= self.start_time
        ):
            raise ValueError("end_time must be after start_time")
        if self.recurrence_until is not None and self.recurrence_until < self.start_date:
            raise ValueError("recurrence_until must not be before start_date")
        if self.recurrence == "none":
            self.recurrence_until = None
        elif self.add_to_timeline:
            raise ValueError("Only a one-off event can be added to the timeline")
        return self

    def row(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class Event(EventIn):
    id: UUID
    timeline_event_id: UUID | None = None

    def span(self) -> EventSpan:
        return EventSpan(
            self.start_date, self.end_date, self.start_time, self.end_time, self.recurrence, self.recurrence_until
        )


class Occurrence(Event):
    """One occurrence of an event: start_date/end_date are this occurrence's dates."""

    all_day: bool
    #: Start date of this occurrence; identifies it (with the event id).
    occurrence_date: date


def to_occurrence(event: Event, span: EventSpan) -> Occurrence:
    return Occurrence(
        **{**event.model_dump(), "start_date": span.start_date, "end_date": span.end_date},
        all_day=event.start_time is None,
        occurrence_date=span.start_date,
    )
