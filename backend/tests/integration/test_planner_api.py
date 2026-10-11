"""Planner endpoints against the real database. The live Claude test is opt-in (it costs money)."""

import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings

TODAY = date(2026, 3, 4)


def iso(days: int = 0) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def create(api: TestClient, **fields) -> dict:
    response = api.post("/todo/tasks", json={"title": "Task", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_apply_moves_accepted_tasks_but_never_fixed_ones(api: TestClient) -> None:
    inbox = create(api, title="Inbox task")
    fixed = create(api, title="Dentist", planned_date=iso(1), fixed_day=True)
    response = api.post(
        "/todo/plan/apply",
        json={
            "today": iso(),
            "changes": [
                {"task_id": inbox["id"], "to_date": iso(2), "order": 0},
                {"task_id": fixed["id"], "to_date": iso(3), "order": 0},
            ],
        },
    )
    assert response.json() == {"applied": 1}
    days = {d["date"]: [t["title"] for t in d["tasks"]] for d in api.get("/todo/days", params={"today": iso()}).json()["days"]}
    assert days[iso(2)] == ["Inbox task"]
    assert days[iso(1)] == ["Dentist"]


@pytest.mark.skipif(
    not (os.environ.get("RUN_CLAUDE_TESTS") == "1" and get_settings().anthropic_api_key),
    reason="Live Claude test: set RUN_CLAUDE_TESTS=1 and ANTHROPIC_API_KEY (costs money)",
)
def test_live_claude_plans_inbox_tasks(api: TestClient) -> None:
    today = date.today().isoformat()
    urgent = create(api, title="Renew passport", deadline=(date.today() + timedelta(days=2)).isoformat(), duration_min=60, priority="high")
    create(api, title="Sort old photos", duration_min=120, priority="low")
    response = api.post("/todo/plan", json={"today": today, "days": 7})
    assert response.status_code == 200, response.text
    proposal = response.json()
    assert proposal["summary"]
    moved = {c["task_id"]: c for c in proposal["changes"]}
    assert urgent["id"] in moved and moved[urgent["id"]]["to_date"] <= (date.today() + timedelta(days=2)).isoformat()


@pytest.mark.skipif(
    not (os.environ.get("RUN_CLAUDE_TESTS") == "1" and get_settings().anthropic_api_key),
    reason="Live Claude test: set RUN_CLAUDE_TESTS=1 and ANTHROPIC_API_KEY (costs money)",
)
def test_live_claude_reads_a_polish_note(api: TestClient) -> None:
    today = date.today()
    response = api.post("/todo/parse", json={"text": "dentysta jutro o 15, ważne; kiedyś posprzątać garaż", "today": today.isoformat()})
    assert response.status_code == 200, response.text
    tasks = {t["title"].lower(): t for t in response.json()["tasks"]}
    dentist = next(t for title, t in tasks.items() if "dentyst" in title)
    assert dentist["planned_date"] == (today + timedelta(days=1)).isoformat()
    assert dentist["priority"] == "high"
    garage = next(t for title, t in tasks.items() if "garaż" in title)
    assert garage["planned_date"] is None and garage["priority"] == "low"
