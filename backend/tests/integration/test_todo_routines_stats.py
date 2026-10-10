"""Routines and statistics through the API against the real Supabase project."""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from tests.integration.conftest import Supa

TODAY = date(2026, 3, 4)  # Wednesday


def iso(days: int = 0) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def feed(api: TestClient) -> dict:
    return api.get("/todo/days", params={"today": iso()}).json()


def routine_tasks(body: dict) -> list[tuple[str, str]]:
    return [(d["date"], t["title"]) for d in body["days"] for t in d["tasks"] if t["routine_id"]]


def test_routine_lifecycle(api: TestClient) -> None:
    created = api.post(
        "/todo/routines",
        json={"title": "Workout", "kind": "weekly", "weekdays": [3], "duration_min": 45, "starts_on": iso(-30)},
    )
    assert created.status_code == 201, created.text
    routine = created.json()
    assert api.get("/todo/routines").json() == [routine]
    assert routine_tasks(feed(api)) == [(iso(), "Workout"), (iso(7), "Workout")]

    # Changing the rule re-creates the upcoming occurrences.
    changed = api.patch(f"/todo/routines/{routine['id']}", params={"today": iso()}, json={"kind": "weekly", "weekdays": [4]})
    assert changed.status_code == 200, changed.text
    assert routine_tasks(feed(api)) == [(iso(1), "Workout"), (iso(8), "Workout")]

    # Pausing removes them; deleting keeps nothing upcoming.
    api.patch(f"/todo/routines/{routine['id']}", params={"today": iso()}, json={"active": False})
    assert routine_tasks(feed(api)) == []
    assert api.delete(f"/todo/routines/{routine['id']}", params={"today": iso()}).status_code == 204
    assert api.get("/todo/routines").json() == []


def test_stats_reflect_done_late_overdue_and_missed(api: TestClient, supa: Supa) -> None:
    def make(**fields) -> dict:
        response = api.post("/todo/tasks", json={"title": "T", **fields})
        assert response.status_code == 201, response.text
        return response.json()

    def complete_on(task: dict, day: str) -> None:
        # Completion time set directly, so the test doesn't depend on the real clock.
        supa.rest(
            "PATCH",
            "todo_tasks",
            params={"id": f"eq.{task['id']}"},
            json={"status": "done", "completed_at": f"{day}T12:00:00Z"},
        )

    complete_on(make(planned_date=iso(0)), iso(0))  # on time
    complete_on(make(planned_date=iso(-3)), iso(-1))  # late
    make(planned_date=iso(-2))  # overdue
    supa.rest("POST", "todo_tasks", json={"title": "Missed", "status": "missed", "planned_date": iso(-1)})

    response = api.get("/todo/stats", params={"today": iso(), "days": 30})
    assert response.status_code == 200, response.text
    stats = response.json()
    assert (stats["done"], stats["on_time"], stats["late"], stats["overdue"], stats["missed"]) == (2, 1, 1, 1, 1)
    assert stats["on_time_rate"] == 0.25
    assert stats["last_week"][-1] == {"date": iso(), "on_time": 1, "late": 0, "missed": 0}
