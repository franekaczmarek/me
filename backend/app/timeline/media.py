"""Event photos: upload (resized by the backend), list with signed URLs, edit, delete.

Files live in the private `timeline-media` bucket under {user_id}/{event_id}/{media_id}-display|thumb.webp.
"""

import logging
from datetime import datetime
from typing import Annotated, Any, Self
from uuid import UUID, uuid4

from fastapi import APIRouter, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field, model_validator

from app.core.supabase import Supabase, SupabaseDep, one_or_404
from app.timeline.images import InvalidImage, process_image

router = APIRouter(prefix="/timeline", tags=["timeline"])
logger = logging.getLogger(__name__)

BUCKET = "timeline-media"
MEDIA = "timeline_event_media"
COLUMNS = "id,event_id,storage_path,thumb_path,caption,position,width,height,created_at"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
URL_TTL_SECONDS = 3600

Caption = Annotated[str, Field(max_length=500)]


class Media(BaseModel):
    id: UUID
    event_id: UUID
    caption: str
    position: int
    width: int | None
    height: int | None
    # Signed, temporary (URL_TTL_SECONDS) links to the private files.
    url: str | None
    thumb_url: str | None
    created_at: datetime


class MediaUpdate(BaseModel):
    caption: Caption | None = None
    position: int | None = Field(None, ge=0)

    @model_validator(mode="after")
    def _no_nulls(self) -> Self:
        for name in ("caption", "position"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


def media_files(db: Supabase, filters: dict[str, str]) -> list[str]:
    """Storage paths of the media rows matching the filters."""
    rows = db.rest("GET", MEDIA, params={"select": "storage_path,thumb_path", **filters})
    return [path for row in rows for path in (row["storage_path"], row["thumb_path"])]


def remove_files_quietly(db: Supabase, paths: list[str]) -> None:
    """Best effort: a leftover file only wastes storage, so it must not fail the request."""
    try:
        db.remove(BUCKET, paths)
    except HTTPException as exc:
        logger.warning("Could not remove %d file(s) from storage: %s", len(paths), exc.detail)


def _with_urls(db: Supabase, rows: list[dict[str, Any]]) -> list[Media]:
    paths = [path for row in rows for path in (row["storage_path"], row["thumb_path"])]
    urls = db.signed_urls(BUCKET, paths, URL_TTL_SECONDS)
    return [
        Media(**row, url=urls.get(row["storage_path"]), thumb_url=urls.get(row["thumb_path"])) for row in rows
    ]


def _read_upload(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"File is larger than {MAX_UPLOAD_BYTES // 2**20} MB")
    return data


@router.get("/events/{event_id}/media", response_model=list[Media])
def list_media(event_id: UUID, db: SupabaseDep) -> list[Media]:
    rows = db.rest(
        "GET", MEDIA, params={"event_id": f"eq.{event_id}", "select": COLUMNS, "order": "position.asc,created_at.asc"}
    )
    return _with_urls(db, rows)


@router.post("/events/{event_id}/media", response_model=Media, status_code=status.HTTP_201_CREATED)
def upload_media(
    event_id: UUID,
    file: UploadFile,
    db: SupabaseDep,
    caption: Annotated[Caption, Form()] = "",
) -> Media:
    """Upload a photo (JPEG, PNG, WebP or GIF, max 20 MB); it's stored as resized WebP files."""
    one_or_404(db.rest("GET", "timeline_events", params={"id": f"eq.{event_id}", "select": "id"}), "Event")
    try:
        image = process_image(_read_upload(file))
    except InvalidImage as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    last = db.rest(
        "GET", MEDIA, params={"event_id": f"eq.{event_id}", "select": "position", "order": "position.desc", "limit": "1"}
    )
    media_id = uuid4()
    base = f"{db.user_id}/{event_id}/{media_id}"
    display_path, thumb_path = f"{base}-display.webp", f"{base}-thumb.webp"
    try:
        db.upload(BUCKET, display_path, image.display, "image/webp")
        db.upload(BUCKET, thumb_path, image.thumb, "image/webp")
        rows = db.rest(
            "POST",
            MEDIA,
            params={"select": COLUMNS},
            json={
                "id": str(media_id),
                "event_id": str(event_id),
                "storage_path": display_path,
                "thumb_path": thumb_path,
                "caption": caption,
                "position": last[0]["position"] + 1 if last else 0,
                "width": image.width,
                "height": image.height,
            },
        )
    except HTTPException:
        remove_files_quietly(db, [display_path, thumb_path])
        raise
    return _with_urls(db, rows)[0]


@router.patch("/media/{media_id}", response_model=Media)
def update_media(media_id: UUID, body: MediaUpdate, db: SupabaseDep) -> Media:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No fields to update")
    rows = db.rest("PATCH", MEDIA, params={"id": f"eq.{media_id}", "select": COLUMNS}, json=changes)
    return _with_urls(db, [one_or_404(rows, "Photo")])[0]


@router.delete("/media/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media(media_id: UUID, db: SupabaseDep) -> Response:
    rows = db.rest("DELETE", MEDIA, params={"id": f"eq.{media_id}", "select": "storage_path,thumb_path"})
    row = one_or_404(rows, "Photo")
    remove_files_quietly(db, [row["storage_path"], row["thumb_path"]])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
