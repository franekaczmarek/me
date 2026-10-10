"""Photo upload/list/edit/delete against the real Supabase database and Storage."""

from collections.abc import Iterator
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.auth import get_jwks_client
from tests.integration.conftest import Supa


def jpeg(size: tuple[int, int]) -> bytes:
    out = BytesIO()
    Image.new("RGB", size, "green").save(out, "JPEG")
    return out.getvalue()


@pytest.fixture
def event(api: TestClient) -> Iterator[dict]:
    response = api.post("/timeline/events", json={"title": "With photos", "start": "2015"})
    assert response.status_code == 201, response.text
    yield response.json()
    # Deleting through the API also removes the files from Storage.
    api.delete(f"/timeline/events/{response.json()['id']}")


def upload(api: TestClient, event_id: str, data: bytes, caption: str = "") -> httpx.Response:
    return api.post(
        f"/timeline/events/{event_id}/media",
        files={"file": ("photo.jpg", data, "image/jpeg")},
        data={"caption": caption},
    )


def download(supa: Supa, url: str) -> httpx.Response:
    return httpx.get(url, verify=get_jwks_client().ssl_context)  # same CA bundle as the app


def storage_files(supa: Supa, folder: str) -> list[str]:
    response = supa.http.post("/storage/v1/object/list/timeline-media", json={"prefix": folder, "limit": 100})
    response.raise_for_status()
    return [item["name"] for item in response.json()]


def test_upload_list_edit_and_delete_a_photo(api: TestClient, supa: Supa, event: dict) -> None:
    response = upload(api, event["id"], jpeg((2400, 1800)), caption="Graduation")
    assert response.status_code == 201, response.text
    photo = response.json()
    assert (photo["width"], photo["height"], photo["caption"], photo["position"]) == (1600, 1200, "Graduation", 0)

    # Signed URLs serve the resized WebP files.
    display = download(supa, photo["url"])
    assert display.status_code == 200
    assert Image.open(BytesIO(display.content)).size == (1600, 1200)
    assert Image.open(BytesIO(download(supa, photo["thumb_url"]).content)).size == (400, 300)

    second = upload(api, event["id"], jpeg((100, 100))).json()
    assert second["position"] == 1
    listed = api.get(f"/timeline/events/{event['id']}/media").json()
    assert [p["id"] for p in listed] == [photo["id"], second["id"]]
    assert all(p["url"] and p["thumb_url"] for p in listed)

    response = api.patch(f"/timeline/media/{photo['id']}", json={"caption": "Prom", "position": 5})
    assert (response.json()["caption"], response.json()["position"]) == ("Prom", 5)

    folder = f"{supa.user_id}/{event['id']}"
    assert len(storage_files(supa, folder)) == 4
    assert api.delete(f"/timeline/media/{photo['id']}").status_code == 204
    assert len(storage_files(supa, folder)) == 2
    assert [p["id"] for p in api.get(f"/timeline/events/{event['id']}/media").json()] == [second["id"]]
    assert api.delete(f"/timeline/media/{photo['id']}").status_code == 404


def test_deleting_the_event_removes_its_photo_files(api: TestClient, supa: Supa) -> None:
    event = api.post("/timeline/events", json={"title": "Temp", "start": "2020"}).json()
    assert upload(api, event["id"], jpeg((50, 50))).status_code == 201
    folder = f"{supa.user_id}/{event['id']}"
    assert len(storage_files(supa, folder)) == 2

    assert api.delete(f"/timeline/events/{event['id']}").status_code == 204
    assert storage_files(supa, folder) == []


def test_invalid_uploads_are_rejected(api: TestClient, event: dict) -> None:
    assert upload(api, event["id"], b"not an image").status_code == 422
    missing = "00000000-0000-0000-0000-000000000000"
    assert upload(api, missing, jpeg((10, 10))).status_code == 404
    assert api.get(f"/timeline/events/{event['id']}/media").json() == []


def test_other_users_files_are_not_reachable(supa: Supa) -> None:
    other = "00000000-0000-0000-0000-000000000001"
    response = supa.http.post(
        f"/storage/v1/object/timeline-media/{other}/x/y.webp",
        content=b"x",
        headers={"Content-Type": "image/webp"},
    )
    assert response.status_code in (400, 403), response.text
