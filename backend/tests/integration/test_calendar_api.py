"""Calendar events: schema, RLS and API against the real Supabase project."""

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from tests.integration.conftest import Supa

CHECK_VIOLATION = "23514"
RLS_VIOLATION = "42501"
BIRTHDAY = {"title": "Mom's birthday", "start_date": "1965-03-14", "end_date": "1965-03-14", "recurrence": "yearly"}


def insert(supa: Supa, table: str, **fields) -> httpx.Response:
    return supa.rest("POST", table, json=fields)


@pytest.mark.parametrize("table", ["calendar_events", "calendar_task_links"])
def test_anonymous_users_cannot_read(anon: httpx.Client, table: str) -> None:
    assert anon.get(f"/rest/v1/{table}").status_code in (401, 403)


def test_events_belong_to_the_logged_in_user(supa: Supa) -> None:
    response = insert(supa, "calendar_events", **BIRTHDAY, user_id=str(uuid.uuid4()))
    assert response.json()["code"] == RLS_VIOLATION


@pytest.mark.parametrize(
    "change",
    [
        {"end_date": "1965-03-13"},
        {"start_time": "10:00"},
        {"start_time": "10:00", "end_time": "09:00"},
        {"color": "#FFFFFF"},
        {"recurrence": "daily"},
        {"recurrence_until": "1960-01-01"},
        {"title": " "},
    ],
)
def test_event_constraints(supa: Supa, change: dict) -> None:
    assert insert(supa, "calendar_events", **{**BIRTHDAY, **change}).json()["code"] == CHECK_VIOLATION


def test_task_links_cascade_and_tasks_keep_their_source(supa: Supa) -> None:
    event = insert(supa, "calendar_events", **BIRTHDAY).json()[0]
    task = insert(
        supa, "todo_tasks", title="Buy a present", source_event_id=event["id"], source_occurrence_date="2027-03-14"
    ).json()[0]
    link = insert(
        supa,
        "calendar_task_links",
        event_id=event["id"],
        occurrence_date="2027-03-14",
        title_key="buy a present",
        status="accepted",
        task_id=task["id"],
    )
    assert link.status_code == 201, link.text
    duplicate = insert(
        supa, "calendar_task_links", event_id=event["id"], occurrence_date="2027-03-14", title_key="buy a present", status="dismissed"
    )
    assert duplicate.status_code == 409

    supa.rest("DELETE", "calendar_events", params={"id": f"eq.{event['id']}"})
    assert supa.rest("GET", "calendar_task_links", params={"event_id": f"eq.{event['id']}"}).json() == []
    kept = supa.rest("GET", "todo_tasks", params={"id": f"eq.{task['id']}"}).json()[0]
    assert (kept["source_event_id"], kept["source_occurrence_date"]) == (None, "2027-03-14")


def test_api_crud_and_occurrences(api: TestClient) -> None:
    created = api.post("/calendar/events", json=BIRTHDAY)
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    visit = api.post(
        "/calendar/events",
        json={"title": "Doctor", "start_date": "2027-03-14", "end_date": "2027-03-14", "start_time": "15:30", "end_time": "16:00"},
    ).json()

    found = api.get("/calendar/events", params={"start": "2027-03-01", "end": "2027-03-31"}).json()
    assert [(o["title"], o["start_date"], o["all_day"]) for o in found] == [
        ("Mom's birthday", "2027-03-14", True),
        ("Doctor", "2027-03-14", False),
    ]
    assert api.get("/calendar/events", params={"start": "2027-04-01", "end": "2027-04-30"}).json() == []

    changed = api.put(f"/calendar/events/{event_id}", json={**BIRTHDAY, "start_date": "1965-04-02", "end_date": "1965-04-02"})
    assert changed.status_code == 200
    april = api.get("/calendar/events", params={"start": "2027-04-01", "end": "2027-04-30"}).json()
    assert [o["start_date"] for o in april] == ["2027-04-02"]

    assert api.delete(f"/calendar/events/{visit['id']}").status_code == 204
    assert api.get(f"/calendar/events/{visit['id']}").status_code == 404


def test_events_reach_the_todo_feed_and_tasks_reach_the_calendar(api: TestClient) -> None:
    today = "2026-10-12"  # a Monday
    api.put(
        "/calendar/work-schedule",
        json={"work_days": [1, 2, 3, 4, 5], "work_start": "09:00", "work_end": "17:00", "task_minutes_workday": 180, "task_minutes_day_off": 360},
    )
    api.post(
        "/calendar/events",
        json={"title": "Dinner", "start_date": today, "end_date": today, "start_time": "18:00", "end_time": "20:00"},
    )
    feed = api.get("/todo/days", params={"today": today}).json()
    monday = feed["days"][0]
    assert [e["title"] for e in monday["events"]] == ["Dinner"]
    assert monday["event_min"] == 120

    task = api.post("/todo/tasks", json={"title": "Buy wine", "planned_date": today}).json()
    found = api.get("/todo/tasks", params={"start": "2026-10-12", "end": "2026-10-18"}).json()
    assert [t["id"] for t in found] == [task["id"]]
    assert found[0]["source_event_id"] is None


def test_events_can_be_added_to_the_life_timeline(api: TestClient) -> None:
    body = {"title": "Kasia's wedding", "start_date": "2026-06-20", "end_date": "2026-06-21", "add_to_timeline": True}
    event = api.post("/calendar/events", json=body).json()
    timeline = {e["id"]: e for e in api.get("/timeline/events").json()}
    entry = timeline[event["timeline_event_id"]]
    assert entry["title"] == "Kasia's wedding"

    renamed = api.put(f"/calendar/events/{event['id']}", json={**body, "title": "Kasia & Tom's wedding"}).json()
    assert renamed["timeline_event_id"] == event["timeline_event_id"]
    assert api.get(f"/timeline/events/{event['timeline_event_id']}").json()["title"] == "Kasia & Tom's wedding"

    unticked = api.put(f"/calendar/events/{event['id']}", json={**body, "add_to_timeline": False}).json()
    assert unticked["timeline_event_id"] is None
    assert api.get(f"/timeline/events/{event['timeline_event_id']}").status_code == 404
