"""Calendar task suggestions: applying them on the real database, plus an opt-in live Claude test."""

import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings


def day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def test_apply_links_tasks_to_events_and_remembers_choices(api: TestClient) -> None:
    birthday = api.post(
        "/calendar/events", json={"title": "Mom's birthday", "start_date": day(12), "end_date": day(12), "recurrence": "yearly"}
    ).json()
    accepted = {
        "event_id": birthday["id"],
        "occurrence_date": day(12),
        "suggested_title": "Buy a present for Mom",
        "title": "Buy a book for Mom",
        "planned_date": day(2),
        "deadline": day(12),
        "duration_min": 60,
    }
    dismissed = {"event_id": birthday["id"], "occurrence_date": day(12), "suggested_title": "Order a cake"}
    body = {"today": day(0), "accepted": [accepted], "dismissed": [dismissed]}
    assert api.post("/calendar/suggest/apply", json=body).json() == {"created": 1, "dismissed": 1}
    # Dismissing again is harmless.
    assert api.post("/calendar/suggest/apply", json={"today": day(0), "dismissed": [dismissed]}).status_code == 200

    tasks = api.get("/todo/tasks", params={"start": day(0), "end": day(12)}).json()
    [task] = [t for t in tasks if t["title"] == "Buy a book for Mom"]
    assert (task["source_event_id"], task["source_occurrence_date"], task["deadline"]) == (birthday["id"], day(12), day(12))

    upcoming = api.get("/calendar/summary", params={"month": day(0), "today": day(0)}).json()["upcoming"]
    assert next(u for u in upcoming if u["id"] == birthday["id"])["has_task"] is True


@pytest.mark.skipif(
    not (os.environ.get("RUN_CLAUDE_TESTS") == "1" and get_settings().anthropic_api_key),
    reason="Live Claude test: set RUN_CLAUDE_TESTS=1 and ANTHROPIC_API_KEY (costs money)",
)
def test_live_claude_suggests_a_present_and_the_visit(api: TestClient) -> None:
    api.post("/calendar/events", json={"title": "Urodziny mamy", "start_date": day(20), "end_date": day(20), "recurrence": "yearly"})
    api.post(
        "/calendar/events",
        json={"title": "Wizyta u lekarza", "start_date": day(4), "end_date": day(4), "start_time": "15:30", "end_time": "16:00"},
    )
    api.post(
        "/calendar/events",
        json={"title": "Siłownia", "start_date": day(1), "end_date": day(1), "start_time": "18:00", "end_time": "19:00", "recurrence": "weekly"},
    )
    response = api.post("/calendar/suggest", json={"today": day(0)})
    assert response.status_code == 200, response.text
    suggestions = response.json()["suggestions"]
    by_event = {}
    for s in suggestions:
        by_event.setdefault(s["event_title"], []).append(s)
    present = by_event["Urodziny mamy"][0]
    assert day(0) <= present["planned_date"] < day(20)
    assert any(s["planned_date"] == day(4) for s in by_event["Wizyta u lekarza"])
    assert "Siłownia" not in by_event


@pytest.mark.skipif(
    not (os.environ.get("RUN_CLAUDE_TESTS") == "1" and get_settings().anthropic_api_key),
    reason="Live Claude test: set RUN_CLAUDE_TESTS=1 and ANTHROPIC_API_KEY (costs money)",
)
def test_live_claude_reads_events_from_a_polish_note(api: TestClient) -> None:
    today = date(2026, 10, 11)  # a Sunday
    response = api.post(
        "/calendar/parse", json={"text": "dentysta w czwartek o 15:30; urodziny Kasi 3 marca co roku", "today": today.isoformat()}
    )
    assert response.status_code == 200, response.text
    events = {e["title"].lower(): e for e in response.json()["events"]}
    dentist = next(e for t, e in events.items() if "dentyst" in t)
    assert (dentist["start_date"], dentist["start_time"], dentist["end_time"]) == ("2026-10-15", "15:30:00", "16:30:00")
    birthday = next(e for t, e in events.items() if "kasi" in t)
    assert (birthday["start_date"], birthday["recurrence"], birthday["start_time"]) == ("2027-03-03", "yearly", None)
