import pytest
from pydantic import ValidationError

from app.timeline.schemas import CategoryCreate, CategoryUpdate, Event, EventCreate, EventUpdate

CATEGORY_ID = "22222222-2222-2222-2222-222222222222"


# --- categories --------------------------------------------------------------


def test_category_name_is_trimmed_and_color_lowercased() -> None:
    category = CategoryCreate(name="  Family ", color="#AABBCC")
    assert (category.name, category.color) == ("Family", "#aabbcc")


@pytest.mark.parametrize("name", ["", "   ", "x" * 61])
def test_category_name_length(name: str) -> None:
    with pytest.raises(ValidationError):
        CategoryCreate(name=name, color="#000000")


@pytest.mark.parametrize("color", ["red", "#12345", "#1234567", "#gggggg", "123456"])
def test_category_color_must_be_hex(color: str) -> None:
    with pytest.raises(ValidationError):
        CategoryCreate(name="Work", color=color)


def test_category_update_rejects_explicit_null() -> None:
    with pytest.raises(ValidationError, match="name cannot be null"):
        CategoryUpdate.model_validate({"name": None})


# --- events: create --------------------------------------------------------------


def test_point_event_to_row() -> None:
    event = EventCreate(title=" Born ", start="1990-03-04")
    assert event.to_row() == {
        "title": "Born",
        "description": "",
        "start_date": "1990-03-04",
        "start_precision": "day",
        "end_date": None,
        "end_precision": None,
        "category_id": None,
    }


def test_period_with_partial_dates_to_row() -> None:
    row = EventCreate(title="High school", start="2015", end="2018-06", category_id=CATEGORY_ID).to_row()
    assert row["start_date"] == "2015-01-01"
    assert row["start_precision"] == "year"
    assert row["end_date"] == "2018-06-01"
    assert row["end_precision"] == "month"
    assert row["category_id"] == CATEGORY_ID


def test_dates_are_normalized() -> None:
    assert EventCreate(title="x", start=" 2015-06 ").start == "2015-06"


@pytest.mark.parametrize("start", ["", "2015-13", "June 2015", "2015-02-30"])
def test_invalid_start_is_rejected(start: str) -> None:
    with pytest.raises(ValidationError):
        EventCreate(title="x", start=start)


def test_end_before_start_is_rejected() -> None:
    with pytest.raises(ValidationError, match="end must not be before start"):
        EventCreate(title="x", start="2018", end="2015")


def test_end_equal_to_start_is_allowed() -> None:
    assert EventCreate(title="x", start="2015", end="2015").end == "2015"


@pytest.mark.parametrize("title", ["", "   ", "x" * 201])
def test_title_length(title: str) -> None:
    with pytest.raises(ValidationError):
        EventCreate(title=title, start="2015")


def test_description_length() -> None:
    with pytest.raises(ValidationError):
        EventCreate(title="x", start="2015", description="x" * 20001)


# --- events: update ----------------------------------------------------------------


def test_update_only_includes_sent_fields() -> None:
    assert EventUpdate(title="New").to_row() == {"title": "New"}


def test_update_end_null_turns_period_into_point() -> None:
    assert EventUpdate.model_validate({"end": None}).to_row() == {"end_date": None, "end_precision": None}


def test_update_category_null_clears_category() -> None:
    assert EventUpdate.model_validate({"category_id": None}).to_row() == {"category_id": None}


def test_update_start_maps_to_date_and_precision() -> None:
    assert EventUpdate(start="2001-09").to_row() == {"start_date": "2001-09-01", "start_precision": "month"}


@pytest.mark.parametrize("field", ["title", "description", "start"])
def test_update_rejects_null_for_required_fields(field: str) -> None:
    with pytest.raises(ValidationError, match=f"{field} cannot be null"):
        EventUpdate.model_validate({field: None})


def test_update_checks_order_when_both_dates_sent() -> None:
    with pytest.raises(ValidationError):
        EventUpdate(start="2020", end="2019")


def test_empty_update_has_no_changes() -> None:
    assert EventUpdate().to_row() == {}


# --- events: from row ----------------------------------------------------------------


def test_event_from_row_formats_partial_dates() -> None:
    event = Event.from_row(
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "title": "High school",
            "description": "",
            "start_date": "2015-01-01",
            "start_precision": "year",
            "end_date": "2018-06-01",
            "end_precision": "month",
            "category_id": None,
            "created_at": "2026-10-10T12:00:00+00:00",
            "updated_at": "2026-10-10T12:00:00+00:00",
        }
    )
    assert (event.start, event.end) == ("2015", "2018-06")
