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
