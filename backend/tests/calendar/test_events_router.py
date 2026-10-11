import json

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


TIMELINE_ID = "99999999-9999-9999-9999-999999999999"
WEDDING = {**ROW, "title": "Wedding", "notes": "Kasia & Tom", "recurrence": "none", "start_date": "2026-06-20", "end_date": "2026-06-21"}


def test_timeline_events_need_a_one_off_event(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.post("/calendar/events", json={**BODY, "add_to_timeline": True}).status_code == 422


def test_adding_to_the_timeline_creates_and_links_an_entry(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [{**WEDDING, "add_to_timeline": True}])
    fake_db.reply(201, [{"id": TIMELINE_ID}])
    fake_db.reply(200, [{**WEDDING, "add_to_timeline": True, "timeline_event_id": TIMELINE_ID}])
    body = {"title": "Wedding", "notes": "Kasia & Tom", "start_date": "2026-06-20", "end_date": "2026-06-21", "add_to_timeline": True}
    response = api.post("/calendar/events", json=body)
    assert response.json()["timeline_event_id"] == TIMELINE_ID
    _, timeline, link = fake_db.requests
    assert timeline.url.path.endswith("/timeline_events")
    assert json.loads(timeline.content) == {
        "title": "Wedding",
        "description": "Kasia & Tom",
        "start_date": "2026-06-20",
        "start_precision": "day",
        "end_date": "2026-06-21",
        "end_precision": "day",
    }
    assert json.loads(link.content) == {"timeline_event_id": TIMELINE_ID}


def test_editing_updates_the_linked_entry(api: TestClient, fake_db: FakeSupabase) -> None:
    linked = {**WEDDING, "end_date": "2026-06-20", "add_to_timeline": True, "timeline_event_id": TIMELINE_ID}
    fake_db.reply(200, [linked])
    fake_db.reply(200, [{"id": TIMELINE_ID}])
    body = {"title": "Wedding", "start_date": "2026-06-20", "end_date": "2026-06-20", "add_to_timeline": True}
    assert api.put(f"/calendar/events/{EVENT_ID}", json=body).status_code == 200
    update = fake_db.last
    assert update.method == "PATCH" and update.url.params["id"] == f"eq.{TIMELINE_ID}"
    assert json.loads(update.content)["end_date"] is None


def test_a_deleted_entry_is_made_again(api: TestClient, fake_db: FakeSupabase) -> None:
    linked = {**WEDDING, "add_to_timeline": True, "timeline_event_id": TIMELINE_ID}
    fake_db.reply(200, [linked])
    fake_db.reply(200, [])  # nothing updated: the entry is gone
    fake_db.reply(201, [{"id": "88888888-8888-8888-8888-888888888888"}])
    fake_db.reply(200, [{**linked, "timeline_event_id": "88888888-8888-8888-8888-888888888888"}])
    body = {"title": "Wedding", "start_date": "2026-06-20", "end_date": "2026-06-21", "add_to_timeline": True}
    assert api.put(f"/calendar/events/{EVENT_ID}", json=body).json()["timeline_event_id"] == "88888888-8888-8888-8888-888888888888"


def test_unticking_removes_the_entry(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{**WEDDING, "timeline_event_id": TIMELINE_ID}])
    fake_db.reply(204, [])
    fake_db.reply(200, [WEDDING])
    body = {"title": "Wedding", "start_date": "2026-06-20", "end_date": "2026-06-21"}
    assert api.put(f"/calendar/events/{EVENT_ID}", json=body).json()["timeline_event_id"] is None
    _, delete, unlink = fake_db.requests
    assert delete.method == "DELETE" and delete.url.params["id"] == f"eq.{TIMELINE_ID}"
    assert json.loads(unlink.content) == {"timeline_event_id": None}
