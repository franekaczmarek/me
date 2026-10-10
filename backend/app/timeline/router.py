"""Timeline API: categories and events. All queries run as the user (RLS applies)."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status

from app.core.supabase import SupabaseDep
from app.timeline.schemas import (
    CATEGORY_COLUMNS,
    EVENT_COLUMNS,
    Category,
    CategoryCreate,
    CategoryUpdate,
    Event,
    EventCreate,
    EventUpdate,
)

router = APIRouter(prefix="/timeline", tags=["timeline"])

CATEGORIES = "timeline_categories"
EVENTS = "timeline_events"


def _one(rows: list[dict], what: str) -> dict:
    # RLS hides other users' rows, so "not yours" and "doesn't exist" look the same.
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return rows[0]


def _by_id(item_id: UUID, columns: str) -> dict[str, str]:
    return {"id": f"eq.{item_id}", "select": columns}


def _require_changes(row: dict) -> None:
    if not row:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No fields to update")


# --- categories ------------------------------------------------------------------


@router.get("/categories", response_model=list[Category])
def list_categories(db: SupabaseDep) -> list[dict]:
    return db.rest("GET", CATEGORIES, params={"select": CATEGORY_COLUMNS, "order": "name.asc"})


@router.post("/categories", response_model=Category, status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, db: SupabaseDep) -> dict:
    rows = db.rest("POST", CATEGORIES, params={"select": CATEGORY_COLUMNS}, json=body.model_dump())
    return rows[0]


@router.patch("/categories/{category_id}", response_model=Category)
def update_category(category_id: UUID, body: CategoryUpdate, db: SupabaseDep) -> dict:
    changes = body.model_dump(exclude_unset=True)
    _require_changes(changes)
    return _one(db.rest("PATCH", CATEGORIES, params=_by_id(category_id, CATEGORY_COLUMNS), json=changes), "Category")


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: UUID, db: SupabaseDep) -> Response:
    """Events in the category are kept; they just lose their category."""
    _one(db.rest("DELETE", CATEGORIES, params=_by_id(category_id, "id")), "Category")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- events ----------------------------------------------------------------------


@router.get("/events", response_model=list[Event])
def list_events(db: SupabaseDep) -> list[Event]:
    rows = db.rest("GET", EVENTS, params={"select": EVENT_COLUMNS, "order": "start_date.asc,created_at.asc"})
    return [Event.from_row(row) for row in rows]


@router.get("/events/{event_id}", response_model=Event)
def get_event(event_id: UUID, db: SupabaseDep) -> Event:
    return Event.from_row(_one(db.rest("GET", EVENTS, params=_by_id(event_id, EVENT_COLUMNS)), "Event"))


@router.post("/events", response_model=Event, status_code=status.HTTP_201_CREATED)
def create_event(body: EventCreate, db: SupabaseDep) -> Event:
    rows = db.rest("POST", EVENTS, params={"select": EVENT_COLUMNS}, json=body.to_row())
    return Event.from_row(rows[0])


@router.patch("/events/{event_id}", response_model=Event)
def update_event(event_id: UUID, body: EventUpdate, db: SupabaseDep) -> Event:
    changes = body.to_row()
    _require_changes(changes)
    rows = db.rest("PATCH", EVENTS, params=_by_id(event_id, EVENT_COLUMNS), json=changes)
    return Event.from_row(_one(rows, "Event"))


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: UUID, db: SupabaseDep) -> Response:
    _one(db.rest("DELETE", EVENTS, params=_by_id(event_id, "id")), "Event")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
