from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.timeline import media
from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

USER_ID = "11111111-1111-1111-1111-111111111111"
EVENT_ID = "33333333-3333-3333-3333-333333333333"
MEDIA_ID = "44444444-4444-4444-4444-444444444444"
DISPLAY = f"{USER_ID}/{EVENT_ID}/{MEDIA_ID}-display.webp"
THUMB = f"{USER_ID}/{EVENT_ID}/{MEDIA_ID}-thumb.webp"

MEDIA_ROW = {
    "id": MEDIA_ID,
    "event_id": EVENT_ID,
    "storage_path": DISPLAY,
    "thumb_path": THUMB,
    "caption": "Prom",
    "position": 0,
    "width": 800,
    "height": 600,
    "created_at": "2026-10-10T12:00:00+00:00",
}
SIGNED = [
    {"path": DISPLAY, "signedURL": f"/object/sign/timeline-media/{DISPLAY}?token=a"},
    {"path": THUMB, "signedURL": f"/object/sign/timeline-media/{THUMB}?token=b"},
]


def jpeg(size: tuple[int, int] = (800, 600)) -> bytes:
    out = BytesIO()
    Image.new("RGB", size, "blue").save(out, "JPEG")
    return out.getvalue()


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token(user_id=USER_ID)}"
    return client


def upload(api: TestClient, data: bytes, caption: str | None = None) -> httpx.Response:
    form = {"caption": caption} if caption is not None else {}
    return api.post(f"/timeline/events/{EVENT_ID}/media", files={"file": ("photo.jpg", data, "image/jpeg")}, data=form)


def by_path(fake_db: FakeSupabase, path: str) -> list[httpx.Request]:
    return [r for r in fake_db.requests if r.url.path == path]


# --- upload --------------------------------------------------------------------


def test_upload_resizes_stores_and_records_the_photo(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": EVENT_ID}])  # event exists
    fake_db.reply(200, [{"position": 2}])  # last photo position
    fake_db.reply(200, {"Key": "x"})  # upload display
    fake_db.reply(200, {"Key": "x"})  # upload thumb
    fake_db.reply(201, [{**MEDIA_ROW, "position": 3}])  # insert row
    fake_db.reply(200, SIGNED)

    response = upload(api, jpeg((3200, 2400)), caption="Prom")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["position"] == 3
    assert body["url"] == f"https://db.test/storage/v1/object/sign/timeline-media/{DISPLAY}?token=a"
    assert body["thumb_url"].endswith("token=b")

    uploads = [r for r in fake_db.requests if r.url.path.startswith("/storage/v1/object/timeline-media/")]
    assert len(uploads) == 2
    display_path = uploads[0].url.path.removeprefix("/storage/v1/object/timeline-media/")
    assert display_path.startswith(f"{USER_ID}/{EVENT_ID}/") and display_path.endswith("-display.webp")
    assert uploads[0].headers["Content-Type"] == "image/webp"
    assert Image.open(BytesIO(uploads[0].content)).size == (1600, 1200)
    assert Image.open(BytesIO(uploads[1].content)).size == (400, 300)

    [insert] = [r for r in by_path(fake_db, "/rest/v1/timeline_event_media") if r.method == "POST"]
    row = httpx.Response(200, content=insert.content).json()
    assert row["storage_path"] == display_path
    assert row["thumb_path"] == display_path.replace("-display", "-thumb")
    assert (row["caption"], row["position"], row["width"], row["height"]) == ("Prom", 3, 1600, 1200)


def test_first_photo_gets_position_zero(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": EVENT_ID}])
    fake_db.reply(200, [])
    fake_db.reply(200, {})
    fake_db.reply(200, {})
    fake_db.reply(201, [MEDIA_ROW])
    fake_db.reply(200, SIGNED)
    assert upload(api, jpeg()).status_code == 201
    [insert] = [r for r in fake_db.requests if r.method == "POST" and r.url.path == "/rest/v1/timeline_event_media"]
    assert httpx.Response(200, content=insert.content).json()["position"] == 0


def test_upload_to_unknown_event_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [])
    assert upload(api, jpeg()).status_code == 404
    assert len(fake_db.requests) == 1


def test_upload_of_non_image_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": EVENT_ID}])
    response = upload(api, b"%PDF-1.7 not an image")
    assert response.status_code == 422
    assert response.json()["detail"] == "Not a valid image"
    assert len(fake_db.requests) == 1


def test_upload_too_large_is_413(api: TestClient, fake_db: FakeSupabase, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(media, "MAX_UPLOAD_BYTES", 100)
    fake_db.reply(200, [{"id": EVENT_ID}])
    assert upload(api, jpeg()).status_code == 413
    assert len(fake_db.requests) == 1


def test_upload_without_file_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.post(f"/timeline/events/{EVENT_ID}/media").status_code == 422
    assert fake_db.requests == []


def test_caption_too_long_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    assert upload(api, jpeg(), caption="x" * 501).status_code == 422
    assert fake_db.requests == []


def test_failed_insert_removes_uploaded_files(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": EVENT_ID}])
    fake_db.reply(200, [])
    fake_db.reply(200, {})
    fake_db.reply(200, {})
    fake_db.reply(500, {"code": "XX000", "message": "boom"})  # insert fails
    fake_db.reply(200, [])  # cleanup
    assert upload(api, jpeg()).status_code == 502
    assert fake_db.last.method == "DELETE"
    assert fake_db.last.url.path == "/storage/v1/object/timeline-media"
    prefixes = fake_db.last_json["prefixes"]
    assert len(prefixes) == 2 and all(p.startswith(f"{USER_ID}/{EVENT_ID}/") for p in prefixes)


def test_failed_storage_upload_is_502_and_cleans_up(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": EVENT_ID}])
    fake_db.reply(200, [])
    fake_db.reply(400, {"statusCode": "403", "error": "Unauthorized", "message": "RLS"})
    assert upload(api, jpeg()).status_code == 502
    assert fake_db.last.method == "DELETE"


# --- list / update / delete ------------------------------------------------------


def test_list_media_signs_all_paths_in_one_call(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [MEDIA_ROW])
    fake_db.reply(200, SIGNED)
    response = api.get(f"/timeline/events/{EVENT_ID}/media")
    assert response.status_code == 200
    [item] = response.json()
    assert item["url"].startswith("https://db.test/storage/v1/object/sign/")
    assert "storage_path" not in item
    assert fake_db.requests[0].url.params["order"] == "position.asc,created_at.asc"
    assert fake_db.last.url.path == "/storage/v1/object/sign/timeline-media"
    assert fake_db.last_json == {"expiresIn": media.URL_TTL_SECONDS, "paths": [DISPLAY, THUMB]}


def test_list_media_without_photos_skips_signing(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get(f"/timeline/events/{EVENT_ID}/media").json() == []
    assert len(fake_db.requests) == 1


def test_update_caption(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{**MEDIA_ROW, "caption": "New"}])
    fake_db.reply(200, SIGNED)
    response = api.patch(f"/timeline/media/{MEDIA_ID}", json={"caption": "New"})
    assert response.status_code == 200
    assert response.json()["caption"] == "New"
    assert fake_db.requests[0].method == "PATCH"


@pytest.mark.parametrize("body", [{}, {"caption": None}, {"position": -1}, {"caption": "x" * 501}])
def test_invalid_media_update_is_422(api: TestClient, fake_db: FakeSupabase, body: dict) -> None:
    assert api.patch(f"/timeline/media/{MEDIA_ID}", json=body).status_code == 422
    assert fake_db.requests == []


def test_update_missing_media_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.patch(f"/timeline/media/{MEDIA_ID}", json={"caption": "x"}).status_code == 404


def test_delete_media_removes_row_and_files(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"storage_path": DISPLAY, "thumb_path": THUMB}])
    fake_db.reply(200, [])
    assert api.delete(f"/timeline/media/{MEDIA_ID}").status_code == 204
    assert fake_db.requests[0].method == "DELETE"
    assert fake_db.last_json == {"prefixes": [DISPLAY, THUMB]}


def test_delete_media_succeeds_even_if_file_removal_fails(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"storage_path": DISPLAY, "thumb_path": THUMB}])
    fake_db.fail(httpx.ConnectError("storage down"))
    assert api.delete(f"/timeline/media/{MEDIA_ID}").status_code == 204


def test_delete_missing_media_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.delete(f"/timeline/media/{MEDIA_ID}").status_code == 404
    assert len(fake_db.requests) == 1


def test_media_endpoints_require_a_token(client: TestClient, fake_db: FakeSupabase) -> None:
    assert client.get(f"/timeline/events/{EVENT_ID}/media").status_code == 401
    assert client.delete(f"/timeline/media/{MEDIA_ID}").status_code == 401
    assert fake_db.requests == []
