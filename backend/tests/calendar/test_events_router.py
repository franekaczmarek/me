import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

EVENT_ID = "77777777-7777-7777-7777-777777777777"
BODY = {
    "title": " Mom's birthday ",
    "start_date": "1965-03-14",
    "end_date": "1965-03-14",
    "recurrence": "yearly",
    "color": "#F27FB2",
}
ROW = {
    "id": EVENT_ID,
    "title": "Mom's birthday",
    "notes": "",
    "location": "",
    "start_date": "1965-03-14",
    "end_date": "1965-03-14",
    "start_time": None,
    "end_time": None,
    "color": "#f27fb2",
    "recurrence": "yearly",
    "recurrence_until": None,
    "add_to_timeline": False,
    "timeline_event_id": None,
}
VISIT = {
    **ROW,
    "id": "66666666-6666-6666-6666-666666666666",
    "title": "Doctor",
    "start_date": "2026-03-14",
    "end_date": "2026-03-14",
    "start_time": "15:30:00",
    "end_time": "16:00:00",
    "recurrence": "none",
}


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


def test_create_event(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [ROW])
    response = api.post("/calendar/events", json=BODY)
    assert response.status_code == 201
    assert response.json() == ROW
    sent = fake_db.last_json
    assert (sent["title"], sent["color"], sent["start_time"], sent["add_to_timeline"]) == (
        "Mom's birthday",
        "#f27fb2",
        None,
        False,
    )


@pytest.mark.parametrize(
    "change",
    [
        {"title": "  "},
        {"end_date": "1965-03-13"},
        {"start_time": "10:00"},
        {"start_time": "10:00", "end_time": "10:00"},
        {"color": "red"},
        {"recurrence": "daily"},
        {"recurrence_until": "1965-01-01"},
    ],
)
def test_invalid_events(api: TestClient, fake_db: FakeSupabase, change: dict) -> None:
    assert api.post("/calendar/events", json={**BODY, **change}).status_code == 422
    assert fake_db.requests == []


def test_overnight_timed_event_is_valid(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [ROW])
    body = {**BODY, "end_date": "1965-03-15", "start_time": "22:00", "end_time": "02:00"}
    assert api.post("/calendar/events", json=body).status_code == 201


def test_until_is_dropped_for_single_events(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [ROW])
    api.post("/calendar/events", json={**BODY, "recurrence": "none", "recurrence_until": "1970-01-01"})
    assert fake_db.last_json["recurrence_until"] is None


def test_list_expands_repeating_events(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [ROW, VISIT])
    response = api.get("/calendar/events", params={"start": "2026-03-01", "end": "2026-03-31"})
    assert response.status_code == 200
    params = fake_db.last.url.params
    assert params["start_date"] == "lte.2026-03-31"
    assert params["or"] == "(recurrence.neq.none,end_date.gte.2026-03-01)"
    found = response.json()
    assert [(o["title"], o["start_date"], o["occurrence_date"], o["all_day"]) for o in found] == [
        ("Mom's birthday", "2026-03-14", "2026-03-14", True),
        ("Doctor", "2026-03-14", "2026-03-14", False),
    ]
    assert found[0]["id"] == EVENT_ID


@pytest.mark.parametrize("params", [{"start": "2026-03-31", "end": "2026-03-01"}, {"start": "2026-01-01", "end": "2027-12-31"}])
def test_list_rejects_bad_ranges(api: TestClient, fake_db: FakeSupabase, params: dict) -> None:
    assert api.get("/calendar/events", params=params).status_code == 422
    assert fake_db.requests == []


def test_read_replace_delete(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [ROW])
    assert api.get(f"/calendar/events/{EVENT_ID}").json() == ROW

    fake_db.reply(200, [ROW])
    assert api.put(f"/calendar/events/{EVENT_ID}", json=BODY).status_code == 200
    assert fake_db.last.method == "PATCH"
    assert fake_db.last.url.params["id"] == f"eq.{EVENT_ID}"

    fake_db.reply(200, [{"id": EVENT_ID}])
    assert api.delete(f"/calendar/events/{EVENT_ID}").status_code == 204


@pytest.mark.parametrize("method", ["get", "put", "delete"])
def test_missing_event_is_404(api: TestClient, fake_db: FakeSupabase, method: str) -> None:
    fake_db.reply(200, [])
    kwargs = {"json": BODY} if method == "put" else {}
    assert getattr(api, method)(f"/calendar/events/{EVENT_ID}", **kwargs).status_code == 404
