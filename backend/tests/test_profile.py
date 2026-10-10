from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

USER_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token(user_id=USER_ID)}"
    return client


def test_profile_requires_a_token(client: TestClient, fake_db: FakeSupabase) -> None:
    assert client.get("/profile").status_code == 401
    assert client.patch("/profile", json={"display_name": "x"}).status_code == 401
    assert fake_db.requests == []


def test_read_profile(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"display_name": "Franek", "birth_date": "1990-03-04"}])
    assert api.get("/profile").json() == {"display_name": "Franek", "birth_date": "1990-03-04"}
    assert fake_db.last.url.path == "/rest/v1/profiles"


def test_missing_profile_reads_as_empty(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get("/profile").json() == {"display_name": None, "birth_date": None}


def test_update_upserts_the_users_row(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [{"display_name": None, "birth_date": "1990-03-04"}])
    response = api.patch("/profile", json={"birth_date": "1990-03-04"})
    assert response.status_code == 200
    assert response.json()["birth_date"] == "1990-03-04"
    assert fake_db.last.method == "POST"
    assert fake_db.last.url.params["on_conflict"] == "id"
    assert "resolution=merge-duplicates" in fake_db.last.headers["Prefer"]
    # Only the sent field is written, so other fields keep their values.
    assert fake_db.last_json == {"id": USER_ID, "birth_date": "1990-03-04"}


def test_update_can_clear_a_field(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [{"display_name": None, "birth_date": None}])
    api.patch("/profile", json={"birth_date": None})
    assert fake_db.last_json == {"id": USER_ID, "birth_date": None}


def test_blank_display_name_is_stored_as_null(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [{"display_name": None, "birth_date": None}])
    api.patch("/profile", json={"display_name": "   "})
    assert fake_db.last_json == {"id": USER_ID, "display_name": None}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"birth_date": "not-a-date"},
        {"birth_date": "2020-02-30"},
        {"birth_date": (date.today() + timedelta(days=1)).isoformat()},
        {"display_name": "x" * 101},
    ],
)
def test_invalid_updates_are_422(api: TestClient, fake_db: FakeSupabase, body: dict) -> None:
    assert api.patch("/profile", json=body).status_code == 422
    assert fake_db.requests == []


def test_old_birth_dates_are_allowed(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [{"display_name": None, "birth_date": "1901-01-01"}])
    assert api.patch("/profile", json={"birth_date": "1901-01-01"}).status_code == 200
