"""User profile: display name and birth date (centers the timeline's initial view)."""

from datetime import date
from typing import Annotated, Any, Self

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, StringConstraints, model_validator

from app.core.supabase import SupabaseDep

router = APIRouter(prefix="/profile", tags=["profile"])

PROFILES = "profiles"
COLUMNS = "display_name,birth_date"

DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]


class Profile(BaseModel):
    display_name: str | None = None
    birth_date: date | None = None


class ProfileUpdate(BaseModel):
    """Partial update: only fields present in the request are changed; null clears a field."""

    display_name: DisplayName | None = None
    birth_date: date | None = None

    @model_validator(mode="after")
    def _validate(self) -> Self:
        if self.birth_date and self.birth_date > date.today():
            raise ValueError("birth_date cannot be in the future")
        if self.display_name == "":
            self.display_name = None
        return self


@router.get("", response_model=Profile)
def read_profile(db: SupabaseDep) -> Any:
    # The row is created on the first update; until then the profile is empty.
    rows = db.rest("GET", PROFILES, params={"select": COLUMNS})
    return rows[0] if rows else Profile()


@router.patch("", response_model=Profile)
def update_profile(body: ProfileUpdate, db: SupabaseDep) -> Any:
    changes = body.model_dump(mode="json", exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No fields to update")
    rows = db.rest(
        "POST",
        PROFILES,
        params={"select": COLUMNS, "on_conflict": "id"},
        json={"id": db.user_id, **changes},
        prefer="resolution=merge-duplicates,return=representation",
    )
    return rows[0]
