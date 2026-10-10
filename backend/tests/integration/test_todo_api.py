"""To-do and calendar API against the real Supabase project (test account's real token)."""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from tests.integration.conftest import Supa

TODAY = date(2026, 3, 4)  # a Wednesday; passed explicitly so tests don't depend on the clock


def iso(days: int = 0) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def create(api: TestClient, **fields) -> dict:
    response = api.post("/todo/tasks", json={"title": "Task", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def feed(api: TestClient) -> dict:
    response = api.get("/todo/days", params={"today": iso()})
    assert response.status_code == 200, response.text
    return response.json()


def titles_on(body: dict, day: str) -> list[str]:
    return [t["title"] for d in body["days"] if d["date"] == day for t in d["tasks"]]


def test_days_feed_shows_overdue_today_week_and_inbox(api: TestClient) -> None:
    create(api, title="Overdue", planned_date=iso(-3))
    create(api, title="Old done", planned_date=iso(-2))
    done = create(api, title="Done before", planned_date=iso(-2))
    api.post(f"/todo/tasks/{done['id']}/complete", json={"today": iso(-2)})
    create(api, title="Today", planned_date=iso(), duration_min=30)
    create(api, title="In ten days", planned_date=iso(10))
    create(api, title="Too far", planned_date=iso(20))
    create(api, title="Inbox", deadline=iso(5))

    body = feed(api)
    dates = [d["date"] for d in body["days"]]
    assert dates[0] == iso(-3)  # overdue first
    assert iso(-2) in dates  # still has an undone task
    assert dates[dates.index(iso()) : dates.index(iso()) + 7] == [iso(n) for n in range(7)]
    assert dates[-1] == iso(10) and iso(20) not in dates
    assert titles_on(body, iso(-2)) == ["Old done"]
    assert titles_on(body, iso()) == ["Today"]
    today = next(d for d in body["days"] if d["is_today"])
    assert (today["planned_min"], today["capacity_min"], today["is_work_day"]) == (30, 180, True)
    assert [t["title"] for t in body["inbox"]] == ["Inbox"]


def test_complete_reopen_and_postpone(api: TestClient) -> None:
    task = create(api, title="Pay rent", planned_date=iso())
    done = api.post(f"/todo/tasks/{task['id']}/complete", json={"today": iso()}).json()
    assert done["status"] == "done" and done["completed_at"]
    assert api.post(f"/todo/tasks/{task['id']}/reopen").json()["status"] == "open"

    moved = api.patch(f"/todo/tasks/{task['id']}", json={"planned_date": iso(2)}).json()
    assert (moved["postponed_count"], moved["first_planned_date"]) == (1, iso())
    to_inbox = api.patch(f"/todo/tasks/{task['id']}", json={"planned_date": None}).json()
    assert to_inbox["planned_date"] is None and to_inbox["postponed_count"] == 2


def test_completing_an_inbox_task_dates_it(api: TestClient) -> None:
    task = create(api, title="Someday")
    done = api.post(f"/todo/tasks/{task['id']}/complete", json={"today": iso()}).json()
    assert done["planned_date"] == iso()


def test_routines_create_occurrences_and_missed_ones_are_hidden(api: TestClient, supa: Supa) -> None:
    routine = supa.rest(
        "POST", "todo_routines", json={"title": "Workout", "kind": "weekly", "weekdays": [3], "starts_on": "2026-01-01"}
    ).json()[0]
    body = feed(api)
    assert titles_on(body, iso()) == ["Workout"]  # TODAY is a Wednesday
    assert "Workout" in titles_on(body, iso(7))

    # Loading again doesn't duplicate occurrences.
    assert titles_on(feed(api), iso()) == ["Workout"]

    # A past undone occurrence becomes missed and disappears.
    supa.rest(
        "POST",
        "todo_tasks",
        json={"title": "Workout", "routine_id": routine["id"], "occurrence_date": iso(-7), "planned_date": iso(-7)},
    )
    body = feed(api)
    assert iso(-7) not in [d["date"] for d in body["days"]]
    [row] = supa.rest("GET", "todo_tasks", params={"occurrence_date": f"eq.{iso(-7)}", "select": "status"}).json()
    assert row["status"] == "missed"


def test_deleting_a_routine_occurrence_skips_it(api: TestClient, supa: Supa) -> None:
    supa.rest("POST", "todo_routines", json={"title": "Daily", "kind": "daily", "starts_on": "2026-01-01"})
    occurrence = next(t for d in feed(api)["days"] if d["is_today"] for t in d["tasks"])
    assert api.delete(f"/todo/tasks/{occurrence['id']}").status_code == 204
    assert titles_on(feed(api), iso()) == []  # not re-created


def test_work_schedule_and_days_off_drive_capacity(api: TestClient) -> None:
    assert api.get("/calendar/work-schedule").json()["work_days"] == [1, 2, 3, 4, 5]
    schedule = {
        "work_days": [1, 2],
        "work_start": "08:00",
        "work_end": "16:00",
        "task_minutes_workday": 60,
        "task_minutes_day_off": 240,
    }
    saved = api.put("/calendar/work-schedule", json=schedule)
    assert saved.status_code == 200, saved.text
    assert api.put("/calendar/work-schedule", json={**schedule, "task_minutes_workday": 90}).json()[
        "task_minutes_workday"
    ] == 90

    day_off = api.post("/calendar/days-off", json={"start_date": iso(5), "end_date": iso(5), "label": "Holiday"})
    assert day_off.status_code == 201, day_off.text

    days = {d["date"]: d for d in feed(api)["days"]}
    assert (days[iso()]["is_work_day"], days[iso()]["capacity_min"]) == (False, 240)  # Wednesday is off now
    assert (days[iso(5)]["is_work_day"], days[iso(5)]["capacity_min"]) == (False, 240)  # Monday, day off
    assert (days[iso(6)]["is_work_day"], days[iso(6)]["capacity_min"]) == (True, 90)  # Tuesday

    assert api.delete(f"/calendar/days-off/{day_off.json()['id']}").status_code == 204
    assert api.get("/calendar/days-off").json() == []
