import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

ROUTINE_ID = "66666666-6666-6666-6666-666666666666"
ROW = {
    "id": ROUTINE_ID,
    "title": "Workout",
    "notes": "",
    "kind": "weekly",
    "weekdays": [1, 3],
    "interval_days": None,
    "month_day": None,
    "duration_min": 45,
    "priority": "normal",
    "active": True,
    "starts_on": "2026-03-01",
    "created_at": "2026-03-01T10:00:00+00:00",
}


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


def test_create_weekly_routine(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [ROW])
    response = api.post("/todo/routines", json={"title": "Workout", "kind": "weekly", "weekdays": [3, 1, 3], "duration_min": 45})
    assert response.status_code == 201
    assert fake_db.last_json == {
        "title": "Workout",
        "notes": "",
        "kind": "weekly",
        "weekdays": [1, 3],
        "duration_min": 45,
        "priority": "normal",
        "active": True,
    }


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x", "kind": "weekly"},
        {"title": "x", "kind": "weekly", "weekdays": [8]},
        {"title": "x", "kind": "interval"},
        {"title": "x", "kind": "monthly", "month_day": 0},
        {"title": "x", "kind": "hourly"},
        {"title": "", "kind": "daily"},
    ],
)
def test_invalid_routines(api: TestClient, fake_db: FakeSupabase, body: dict) -> None:
    assert api.post("/todo/routines", json=body).status_code == 422
    assert fake_db.requests == []


def test_list_routines(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [ROW])
    assert api.get("/todo/routines").json()[0]["title"] == "Workout"


def test_update_routine_regenerates_upcoming_occurrences(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{**ROW, "duration_min": 60}])
    fake_db.reply(204)
    response = api.patch(f"/todo/routines/{ROUTINE_ID}", params={"today": "2026-03-04"}, json={"duration_min": 60})
    assert response.status_code == 200
    drop = fake_db.last
    assert (drop.method, drop.url.path) == ("DELETE", "/rest/v1/todo_tasks")
    assert drop.url.params["routine_id"] == f"eq.{ROUTINE_ID}"
    assert drop.url.params["status"] == "eq.open"
    assert drop.url.params["planned_date"] == "gte.2026-03-04"


@pytest.mark.parametrize("body", [{}, {"title": None}, {"kind": "weekly", "weekdays": []}])
def test_invalid_updates(api: TestClient, fake_db: FakeSupabase, body: dict) -> None:
    assert api.patch(f"/todo/routines/{ROUTINE_ID}", json=body).status_code == 422


def test_update_missing_routine_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.patch(f"/todo/routines/{ROUTINE_ID}", json={"title": "x"}).status_code == 404


def test_delete_routine_drops_upcoming_tasks_first(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(204)
    fake_db.reply(200, [{"id": ROUTINE_ID}])
    assert api.delete(f"/todo/routines/{ROUTINE_ID}", params={"today": "2026-03-04"}).status_code == 204
    assert [r.url.path for r in fake_db.requests] == ["/rest/v1/todo_tasks", "/rest/v1/todo_routines"]


def test_stats(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [])
    response = api.get("/todo/stats", params={"today": "2026-03-04", "days": 7})
    assert response.status_code == 200
    body = response.json()
    assert (body["days"], body["done"], body["on_time_rate"], len(body["last_week"])) == (7, 0, None, 7)
    assert "completed_at.gte.2026-02-26T00:00:00Z" in fake_db.last.url.params["or"]


def test_stats_period_is_limited(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get("/todo/stats", params={"days": 0}).status_code == 422
    assert api.get("/todo/stats", params={"days": 400}).status_code == 422
