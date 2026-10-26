import json

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

USER_ID = "11111111-1111-1111-1111-111111111111"
TASK_ID = "55555555-5555-5555-5555-555555555555"
ROUTINE_ID = "66666666-6666-6666-6666-666666666666"

TASK_ROW = {
    "id": TASK_ID,
    "title": "Pay rent",
    "notes": "",
    "planned_date": "2026-03-04",
    "deadline": None,
    "duration_min": 15,
    "priority": "normal",
    "fixed_day": False,
    "status": "open",
    "completed_at": None,
    "first_planned_date": "2026-03-04",
    "postponed_count": 0,
    "routine_id": None,
    "occurrence_date": None,
    "position": 0,
    "created_at": "2026-03-01T10:00:00+00:00",
}
ROUTINE_ROW = {
    "id": ROUTINE_ID,
    "title": "Workout",
    "notes": "",
    "kind": "weekly",
    "weekdays": [3],  # Wednesday
    "interval_days": None,
    "month_day": None,
    "duration_min": 45,
    "priority": "normal",
    "starts_on": "2026-01-01",
}


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token(user_id=USER_ID)}"
    return client


def requests_to(fake_db: FakeSupabase, path: str, method: str | None = None):
    return [r for r in fake_db.requests if r.url.path == path and (method is None or r.method == method)]


# --- days feed -----------------------------------------------------------------------


def test_days_feed_requires_a_token(client: TestClient, fake_db: FakeSupabase) -> None:
    assert client.get("/todo/days").status_code == 401
    assert fake_db.requests == []


def test_days_feed(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [])  # routines
    fake_db.reply(204)  # mark missed
    fake_db.reply(200, [TASK_ROW, {**TASK_ROW, "id": "77777777-7777-7777-7777-777777777777", "planned_date": None}])
    fake_db.reply(200, [])  # days off
    fake_db.reply(200, [])  # schedule: defaults

    response = api.get("/todo/days", params={"today": "2026-03-04"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["today"] == "2026-03-04"
    assert [d["date"] for d in body["days"]][:2] == ["2026-03-04", "2026-03-05"]
    assert body["days"][0]["is_today"] and body["days"][0]["planned_min"] == 15
    assert body["days"][0]["capacity_min"] == 180
    assert [t["title"] for t in body["days"][0]["tasks"]] == ["Pay rent"]
    assert len(body["inbox"]) == 1

    [tasks_query] = requests_to(fake_db, "/rest/v1/todo_tasks", "GET")
    assert tasks_query.url.params["status"] == "neq.missed"
    assert "planned_date.is.null" in tasks_query.url.params["or"]
    [missed] = requests_to(fake_db, "/rest/v1/todo_tasks", "PATCH")
    assert missed.url.params["planned_date"] == "lt.2026-03-04"
    assert missed.url.params["routine_id"] == "not.is.null"


def test_days_feed_creates_routine_occurrences_for_two_weeks(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [ROUTINE_ROW])
    fake_db.reply(204)  # mark missed
    fake_db.reply(201, [])  # insert occurrences
    fake_db.reply(200, [])
    fake_db.reply(200, [])
    fake_db.reply(200, [])
    assert api.get("/todo/days", params={"today": "2026-03-04"}).status_code == 200

    [insert] = requests_to(fake_db, "/rest/v1/todo_tasks", "POST")
    assert insert.url.params["on_conflict"] == "routine_id,occurrence_date"
    assert "ignore-duplicates" in insert.headers["Prefer"]
    rows = json.loads(insert.content)
    # Wednesdays from 2026-03-04 to 2026-03-17.
    assert [r["occurrence_date"] for r in rows] == ["2026-03-04", "2026-03-11"]
    assert (rows[0]["planned_date"], rows[0]["routine_id"], rows[0]["duration_min"]) == ("2026-03-04", ROUTINE_ID, 45)


def test_days_feed_without_sync_only_reads(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [TASK_ROW])
    response = api.get("/todo/days", params={"today": "2026-03-04", "sync": "false"})

    assert response.status_code == 200, response.text
    assert [t["title"] for t in response.json()["days"][0]["tasks"]] == ["Pay rent"]
    assert {r.method for r in fake_db.requests} == {"GET"}
    assert requests_to(fake_db, "/rest/v1/todo_routines") == []
    paths = sorted(r.url.path for r in fake_db.requests)
    assert paths == sorted(
        ["/rest/v1/todo_tasks", "/rest/v1/calendar_days_off", "/rest/v1/calendar_work_schedule", "/rest/v1/calendar_events"]
    )


def test_days_feed_rejects_a_bad_date(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get("/todo/days", params={"today": "tomorrow"}).status_code == 422


# --- tasks ---------------------------------------------------------------------------


def test_create_task_in_the_inbox(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [{**TASK_ROW, "planned_date": None}])
    response = api.post("/todo/tasks", json={"title": " Pay rent ", "duration_min": 15})
    assert response.status_code == 201
    assert fake_db.last_json == {
        "title": "Pay rent",
        "notes": "",
        "planned_date": None,
        "deadline": None,
        "duration_min": 15,
        "priority": "normal",
        "fixed_day": False,
    }


@pytest.mark.parametrize(
    "body",
    [
        {"title": ""},
        {"title": "x", "priority": "urgent"},
        {"title": "x", "duration_min": 0},
        {"title": "x", "fixed_day": True},
        {"title": "x", "planned_date": "soon"},
    ],
)
def test_invalid_tasks_are_rejected(api: TestClient, fake_db: FakeSupabase, body: dict) -> None:
    assert api.post("/todo/tasks", json=body).status_code == 422
    assert fake_db.requests == []


def test_move_task_to_the_inbox_unfixes_it(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{**TASK_ROW, "planned_date": None}])
    assert api.patch(f"/todo/tasks/{TASK_ID}", json={"planned_date": None}).status_code == 200
    assert fake_db.last_json == {"planned_date": None, "fixed_day": False}


def test_update_task(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{**TASK_ROW, "planned_date": "2026-03-06"}])
    response = api.patch(f"/todo/tasks/{TASK_ID}", json={"planned_date": "2026-03-06", "priority": "high"})
    assert response.status_code == 200
    assert fake_db.last_json == {"planned_date": "2026-03-06", "priority": "high"}


@pytest.mark.parametrize("body", [{}, {"title": None}, {"position": -1}])
def test_invalid_updates(api: TestClient, fake_db: FakeSupabase, body: dict) -> None:
    assert api.patch(f"/todo/tasks/{TASK_ID}", json=body).status_code == 422


def test_update_missing_task_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.patch(f"/todo/tasks/{TASK_ID}", json={"title": "x"}).status_code == 404


def test_complete_a_planned_task(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"planned_date": "2026-03-04"}])
    fake_db.reply(200, [{**TASK_ROW, "status": "done", "completed_at": "2026-03-04T18:00:00+00:00"}])
    response = api.post(f"/todo/tasks/{TASK_ID}/complete", json={"today": "2026-03-04"})
    assert response.status_code == 200
    assert response.json()["status"] == "done"
    assert fake_db.last_json["status"] == "done"
    assert fake_db.last_json["completed_at"]
    assert "planned_date" not in fake_db.last_json


def test_completing_from_the_inbox_records_the_day(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"planned_date": None}])
    fake_db.reply(200, [{**TASK_ROW, "status": "done", "completed_at": "2026-03-04T18:00:00+00:00"}])
    api.post(f"/todo/tasks/{TASK_ID}/complete", json={"today": "2026-03-04"})
    assert fake_db.last_json["planned_date"] == "2026-03-04"


def test_complete_missing_task_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.post(f"/todo/tasks/{TASK_ID}/complete").status_code == 404


def test_reopen(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [TASK_ROW])
    assert api.post(f"/todo/tasks/{TASK_ID}/reopen").status_code == 200
    assert fake_db.last_json == {"status": "open", "completed_at": None}


def test_delete_a_task(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [])  # not a routine occurrence
    fake_db.reply(200, [{"id": TASK_ID}])
    assert api.delete(f"/todo/tasks/{TASK_ID}").status_code == 204
    assert fake_db.last.method == "DELETE"


def test_deleting_a_routine_occurrence_skips_it(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"id": TASK_ID}])
    assert api.delete(f"/todo/tasks/{TASK_ID}").status_code == 204
    assert fake_db.last.method == "PATCH"
    assert fake_db.last_json == {"status": "missed", "completed_at": None}


def test_delete_missing_task_is_404(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.delete(f"/todo/tasks/{TASK_ID}").status_code == 404


def test_tasks_in_a_range(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [])
    response = api.get("/todo/tasks", params={"start": "2026-10-01", "end": "2026-10-31"})
    assert response.status_code == 200
    params = fake_db.last.url.params
    assert params["and"] == "(planned_date.gte.2026-10-01,planned_date.lte.2026-10-31)"
    assert params["status"] == "neq.missed"
    assert "source_event_id" in params["select"]


@pytest.mark.parametrize("params", [{"start": "2026-10-31", "end": "2026-10-01"}, {"start": "2026-01-01", "end": "2027-06-01"}])
def test_tasks_in_a_range_rejects_bad_ranges(api: TestClient, fake_db: FakeSupabase, params: dict) -> None:
    assert api.get("/todo/tasks", params=params).status_code == 422
