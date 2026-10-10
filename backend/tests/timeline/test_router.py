import httpx
import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

USER_ID = "11111111-1111-1111-1111-111111111111"
CATEGORY_ID = "22222222-2222-2222-2222-222222222222"
EVENT_ID = "33333333-3333-3333-3333-333333333333"

CATEGORY_ROW = {"id": CATEGORY_ID, "name": "Family", "color": "#aabbcc"}
EVENT_ROW = {
    "id": EVENT_ID,
    "title": "High school",
    "description": "",
    "start_date": "2015-09-01",
    "start_precision": "month",
    "end_date": "2018-01-01",
    "end_precision": "year",
    "category_id": CATEGORY_ID,
    "created_at": "2026-10-10T12:00:00+00:00",
    "updated_at": "2026-10-10T12:00:00+00:00",
}


@pytest.fixture
def token() -> str:
    return make_token(user_id=USER_ID)


@pytest.fixture
def api(client: TestClient, token: str) -> TestClient:
    client.headers["Authorization"] = f"Bearer {token}"
    return client


# --- auth and DB plumbing --------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/timeline/categories"),
        ("POST", "/timeline/categories"),
        ("GET", "/timeline/events"),
        ("POST", "/timeline/events"),
        ("PATCH", f"/timeline/events/{EVENT_ID}"),
        ("DELETE", f"/timeline/events/{EVENT_ID}"),
    ],
)
def test_endpoints_require_a_token(client: TestClient, fake_db: FakeSupabase, method: str, path: str) -> None:
    assert client.request(method, path).status_code == 401
    assert fake_db.requests == []


def test_queries_supabase_with_the_users_token(api: TestClient, fake_db: FakeSupabase, token: str) -> None:
    api.get("/timeline/categories")
    assert fake_db.last.headers["Authorization"] == f"Bearer {token}"
    assert fake_db.last.headers["Prefer"] == "return=representation"


@pytest.mark.parametrize(
    ("db_status", "code", "expected"),
    [
        (409, "23505", 409),
        (409, "23503", 422),
        (400, "23514", 422),
        (400, "22P02", 422),
        (401, "PGRST301", 401),
        (500, "XX000", 502),
    ],
)
def test_maps_database_errors(api: TestClient, fake_db: FakeSupabase, db_status: int, code: str, expected: int) -> None:
    fake_db.reply(db_status, {"code": code, "message": "boom"})
    assert api.get("/timeline/categories").status_code == expected


def test_returns_503_when_supabase_is_unreachable(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.fail(httpx.ConnectError("down"))
    assert api.get("/timeline/categories").status_code == 503


def test_non_json_error_body_is_a_502(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db._replies.append(httpx.Response(500, text="oops"))
    assert api.get("/timeline/categories").status_code == 502


# --- categories --------------------------------------------------------------------


def test_list_categories(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [CATEGORY_ROW])
    response = api.get("/timeline/categories")
    assert response.status_code == 200
    assert response.json() == [CATEGORY_ROW]
    assert fake_db.last.method == "GET"
    assert fake_db.last.url.path == "/rest/v1/timeline_categories"
    assert fake_db.last.url.params["order"] == "name.asc"


def test_create_category(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [CATEGORY_ROW])
    response = api.post("/timeline/categories", json={"name": " Family ", "color": "#AABBCC"})
    assert response.status_code == 201
    assert response.json() == CATEGORY_ROW
    # user_id is never sent: the DB fills it from the token.
    assert fake_db.last_json == {"name": "Family", "color": "#aabbcc"}


def test_create_category_validates_before_hitting_db(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.post("/timeline/categories", json={"name": "x", "color": "blue"}).status_code == 422
    assert fake_db.requests == []


def test_create_category_duplicate_name_is_409(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(409, {"code": "23505", "message": "duplicate key"})
    assert api.post("/timeline/categories", json={"name": "Family", "color": "#000000"}).status_code == 409


def test_update_category(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{**CATEGORY_ROW, "color": "#000000"}])
    response = api.patch(f"/timeline/categories/{CATEGORY_ID}", json={"color": "#000000"})
    assert response.status_code == 200
    assert response.json()["color"] == "#000000"
    assert fake_db.last.method == "PATCH"
    assert fake_db.last.url.params["id"] == f"eq.{CATEGORY_ID}"
    assert fake_db.last_json == {"color": "#000000"}


def test_update_missing_category_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [])
    assert api.patch(f"/timeline/categories/{CATEGORY_ID}", json={"name": "x"}).status_code == 404


def test_update_category_without_fields_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.patch(f"/timeline/categories/{CATEGORY_ID}", json={}).status_code == 422
    assert fake_db.requests == []


def test_delete_category(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": CATEGORY_ID}])
    response = api.delete(f"/timeline/categories/{CATEGORY_ID}")
    assert response.status_code == 204
    assert fake_db.last.method == "DELETE"
    assert fake_db.last.url.params["id"] == f"eq.{CATEGORY_ID}"


def test_delete_missing_category_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.delete(f"/timeline/categories/{CATEGORY_ID}").status_code == 404


def test_invalid_id_in_path_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.delete("/timeline/categories/not-a-uuid").status_code == 422
    assert fake_db.requests == []


# --- events ------------------------------------------------------------------------


def test_list_events_returns_partial_dates(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [EVENT_ROW])
    response = api.get("/timeline/events")
    assert response.status_code == 200
    [event] = response.json()
    assert (event["start"], event["end"], event["category_id"]) == ("2015-09", "2018", CATEGORY_ID)
    assert fake_db.last.url.params["order"] == "start_date.asc,created_at.asc"


def test_get_event(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [EVENT_ROW])
    assert api.get(f"/timeline/events/{EVENT_ID}").json()["title"] == "High school"
    assert fake_db.last.url.params["id"] == f"eq.{EVENT_ID}"


def test_get_missing_event_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get(f"/timeline/events/{EVENT_ID}").status_code == 404


def test_create_event(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [EVENT_ROW])
    response = api.post(
        "/timeline/events",
        json={"title": "High school", "start": "2015-09", "end": "2018", "category_id": CATEGORY_ID},
    )
    assert response.status_code == 201
    assert response.json()["start"] == "2015-09"
    assert fake_db.last_json == {
        "title": "High school",
        "description": "",
        "start_date": "2015-09-01",
        "start_precision": "month",
        "end_date": "2018-01-01",
        "end_precision": "year",
        "category_id": CATEGORY_ID,
    }


def test_create_event_with_end_before_start_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    response = api.post("/timeline/events", json={"title": "x", "start": "2018", "end": "2015"})
    assert response.status_code == 422
    assert fake_db.requests == []


def test_create_event_with_unknown_category_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(409, {"code": "23503", "message": "foreign key violation"})
    response = api.post("/timeline/events", json={"title": "x", "start": "2018", "category_id": CATEGORY_ID})
    assert response.status_code == 422


def test_update_event_sends_only_changed_columns(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{**EVENT_ROW, "end_date": None, "end_precision": None}])
    response = api.patch(f"/timeline/events/{EVENT_ID}", json={"end": None})
    assert response.status_code == 200
    assert response.json()["end"] is None
    assert fake_db.last_json == {"end_date": None, "end_precision": None}


def test_update_missing_event_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.patch(f"/timeline/events/{EVENT_ID}", json={"title": "x"}).status_code == 404


def test_update_event_without_fields_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.patch(f"/timeline/events/{EVENT_ID}", json={}).status_code == 422
    assert fake_db.requests == []


def test_update_event_violating_db_order_check_is_422(api: TestClient, fake_db: FakeSupabase) -> None:
    # Only `end` sent: the API can't compare it with the stored start, the DB check does.
    fake_db.reply(400, {"code": "23514", "message": "end_not_before_start"})
    assert api.patch(f"/timeline/events/{EVENT_ID}", json={"end": "1900"}).status_code == 422


def test_delete_event(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": EVENT_ID}])
    assert api.delete(f"/timeline/events/{EVENT_ID}").status_code == 204
    assert fake_db.last.method == "DELETE"


def test_delete_missing_event_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.delete(f"/timeline/events/{EVENT_ID}").status_code == 404
