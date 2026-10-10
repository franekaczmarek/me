import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

USER_ID = "11111111-1111-1111-1111-111111111111"
DAY_OFF_ID = "88888888-8888-8888-8888-888888888888"
SCHEDULE = {
    "work_days": [1, 2, 3, 4],
    "work_start": "08:00:00",
    "work_end": "16:00:00",
    "task_minutes_workday": 120,
    "task_minutes_day_off": 300,
}


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token(user_id=USER_ID)}"
    return client


def test_requires_a_token(client: TestClient, fake_db: FakeSupabase) -> None:
    assert client.get("/calendar/work-schedule").status_code == 401


def test_default_schedule_until_one_is_saved(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get("/calendar/work-schedule").json() == {
        "work_days": [1, 2, 3, 4, 5],
        "work_start": "09:00:00",
        "work_end": "17:00:00",
        "task_minutes_workday": 180,
        "task_minutes_day_off": 360,
    }


def test_saved_schedule(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [SCHEDULE])
    assert api.get("/calendar/work-schedule").json() == SCHEDULE


def test_save_schedule_upserts(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [SCHEDULE])
    body = {**SCHEDULE, "work_days": [4, 1, 2, 3, 3], "work_start": "08:00", "work_end": "16:00"}
    response = api.put("/calendar/work-schedule", json=body)
    assert response.status_code == 200
    assert fake_db.last.url.params["on_conflict"] == "user_id"
    assert "merge-duplicates" in fake_db.last.headers["Prefer"]
    assert fake_db.last_json == {"user_id": USER_ID, **SCHEDULE}


@pytest.mark.parametrize(
    "change",
    [
        {"work_days": [0]},
        {"work_days": [8]},
        {"work_start": "17:00", "work_end": "09:00"},
        {"task_minutes_workday": -1},
        {"task_minutes_day_off": 1441},
    ],
)
def test_invalid_schedules(api: TestClient, fake_db: FakeSupabase, change: dict) -> None:
    assert api.put("/calendar/work-schedule", json={**SCHEDULE, **change}).status_code == 422
    assert fake_db.requests == []


def test_days_off(api: TestClient, fake_db: FakeSupabase) -> None:
    row = {"id": DAY_OFF_ID, "start_date": "2026-08-01", "end_date": "2026-08-14", "label": "Vacation"}
    fake_db.reply(201, [row])
    response = api.post("/calendar/days-off", json={"start_date": "2026-08-01", "end_date": "2026-08-14", "label": " Vacation "})
    assert response.status_code == 201
    assert fake_db.last_json == {"start_date": "2026-08-01", "end_date": "2026-08-14", "label": "Vacation"}

    fake_db.reply(200, [row])
    assert api.get("/calendar/days-off").json() == [row]
    assert fake_db.last.url.params["order"] == "start_date.asc"

    fake_db.reply(200, [{"id": DAY_OFF_ID}])
    assert api.delete(f"/calendar/days-off/{DAY_OFF_ID}").status_code == 204
    assert api.delete(f"/calendar/days-off/{DAY_OFF_ID}").status_code == 404


def test_day_off_must_not_end_before_it_starts(api: TestClient, fake_db: FakeSupabase) -> None:
    response = api.post("/calendar/days-off", json={"start_date": "2026-08-14", "end_date": "2026-08-01"})
    assert response.status_code == 422
