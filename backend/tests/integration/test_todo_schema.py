"""To-do and work-calendar schema, constraints, triggers and RLS against the real Supabase project."""

import uuid

import httpx
import pytest

from tests.integration.conftest import Supa

CHECK_VIOLATION = "23514"
UNIQUE_VIOLATION = "23505"
RLS_VIOLATION = "42501"


def insert(supa: Supa, table: str, **fields) -> httpx.Response:
    return supa.rest("POST", table, json=fields)


def make_task(supa: Supa, **fields) -> dict:
    response = insert(supa, "todo_tasks", title="Task", **fields)
    assert response.status_code == 201, response.text
    return response.json()[0]


def make_routine(supa: Supa, **fields) -> dict:
    response = insert(supa, "todo_routines", **{"title": "Routine", "kind": "daily", **fields})
    assert response.status_code == 201, response.text
    return response.json()[0]


def update_task(supa: Supa, task_id: str, **fields) -> dict:
    response = supa.rest("PATCH", "todo_tasks", params={"id": f"eq.{task_id}"}, json=fields)
    assert response.status_code == 200, response.text
    return response.json()[0]


# --- access control --------------------------------------------------------------


@pytest.mark.parametrize("table", ["todo_tasks", "todo_routines", "calendar_work_schedule", "calendar_days_off"])
def test_anonymous_users_cannot_read(anon: httpx.Client, table: str) -> None:
    assert anon.get(f"/rest/v1/{table}").status_code in (401, 403)


def test_rows_belong_to_the_logged_in_user(supa: Supa) -> None:
    assert make_task(supa)["user_id"] == supa.user_id
    other = str(uuid.uuid4())
    assert insert(supa, "todo_tasks", title="x", user_id=other).json()["code"] == RLS_VIOLATION
    assert insert(supa, "calendar_days_off", start_date="2026-01-01", end_date="2026-01-02", user_id=other).json()[
        "code"
    ] == RLS_VIOLATION


# --- tasks -------------------------------------------------------------------------


def test_task_defaults_to_open_in_the_inbox(supa: Supa) -> None:
    task = make_task(supa)
    assert task["planned_date"] is None
    assert (task["status"], task["priority"], task["fixed_day"], task["postponed_count"]) == ("open", "normal", False, 0)


@pytest.mark.parametrize(
    "fields",
    [
        {"title": " "},
        {"priority": "urgent"},
        {"status": "later"},
        {"duration_min": 0},
        {"duration_min": 1441},
        {"status": "done"},  # done needs completed_at
        {"completed_at": "2026-01-01T10:00:00Z"},  # completed_at needs done
        {"fixed_day": True},  # a fixed day needs a planned date
    ],
)
def test_invalid_tasks_are_rejected(supa: Supa, fields: dict) -> None:
    response = insert(supa, "todo_tasks", **{"title": "x", **fields})
    assert response.json()["code"] == CHECK_VIOLATION, fields


def test_done_task_keeps_its_completion_time(supa: Supa) -> None:
    task = make_task(supa, planned_date="2026-03-02")
    done = update_task(supa, task["id"], status="done", completed_at="2026-03-02T18:00:00Z")
    assert done["status"] == "done"


def test_first_planned_date_and_postponements_are_tracked(supa: Supa) -> None:
    task = make_task(supa)
    assert task["first_planned_date"] is None

    task = update_task(supa, task["id"], planned_date="2026-03-02")
    assert (task["first_planned_date"], task["postponed_count"]) == ("2026-03-02", 0)

    task = update_task(supa, task["id"], planned_date="2026-03-04")  # later: postponed
    assert (task["first_planned_date"], task["postponed_count"]) == ("2026-03-02", 1)

    task = update_task(supa, task["id"], planned_date="2026-03-03")  # earlier: not a postponement
    assert task["postponed_count"] == 1

    task = update_task(supa, task["id"], planned_date=None)  # back to the inbox counts
    assert task["postponed_count"] == 2

    task = update_task(supa, task["id"], title="Renamed")  # other edits don't count
    assert task["postponed_count"] == 2


# --- routines -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        {"kind": "hourly"},
        {"kind": "weekly"},
        {"kind": "weekly", "weekdays": []},
        {"kind": "weekly", "weekdays": [0]},
        {"kind": "interval"},
        {"kind": "interval", "interval_days": 0},
        {"kind": "monthly"},
        {"kind": "monthly", "month_day": 32},
    ],
)
def test_invalid_routines_are_rejected(supa: Supa, fields: dict) -> None:
    assert insert(supa, "todo_routines", title="x", **fields).json()["code"] == CHECK_VIOLATION, fields


def test_valid_routine_rules(supa: Supa) -> None:
    make_routine(supa, kind="weekly", weekdays=[1, 3, 5])
    make_routine(supa, kind="interval", interval_days=3)
    make_routine(supa, kind="monthly", month_day=15)
    make_routine(supa, kind="weekdays")


def test_one_task_per_routine_occurrence(supa: Supa) -> None:
    routine = make_routine(supa)
    make_task(supa, routine_id=routine["id"], occurrence_date="2026-03-02", planned_date="2026-03-02")
    duplicate = insert(supa, "todo_tasks", title="x", routine_id=routine["id"], occurrence_date="2026-03-02")
    assert duplicate.json()["code"] == UNIQUE_VIOLATION
    assert insert(supa, "todo_tasks", title="x", routine_id=routine["id"]).json()["code"] == CHECK_VIOLATION


def test_deleting_a_routine_keeps_its_past_tasks(supa: Supa) -> None:
    routine = make_routine(supa)
    task = make_task(supa, routine_id=routine["id"], occurrence_date="2026-03-02", planned_date="2026-03-02")
    supa.rest("DELETE", "todo_routines", params={"id": f"eq.{routine['id']}"})
    [kept] = supa.rest("GET", "todo_tasks", params={"id": f"eq.{task['id']}"}).json()
    assert kept["routine_id"] is None
    assert kept["occurrence_date"] == "2026-03-02"


def test_routine_of_another_user_cannot_be_referenced(supa: Supa) -> None:
    response = insert(supa, "todo_tasks", title="x", routine_id=str(uuid.uuid4()), occurrence_date="2026-03-02")
    assert response.json()["code"] == "23503"


# --- work calendar ---------------------------------------------------------------------


def test_work_schedule_defaults(supa: Supa) -> None:
    response = insert(supa, "calendar_work_schedule")
    assert response.status_code == 201, response.text
    schedule = response.json()[0]
    assert schedule["work_days"] == [1, 2, 3, 4, 5]
    assert (schedule["work_start"], schedule["work_end"]) == ("09:00:00", "17:00:00")
    assert (schedule["task_minutes_workday"], schedule["task_minutes_day_off"]) == (180, 360)
    # One schedule per user.
    assert insert(supa, "calendar_work_schedule").json()["code"] == UNIQUE_VIOLATION


@pytest.mark.parametrize(
    "fields",
    [{"work_days": [8]}, {"work_start": "17:00", "work_end": "09:00"}, {"task_minutes_workday": -1}],
)
def test_invalid_work_schedules_are_rejected(supa: Supa, fields: dict) -> None:
    assert insert(supa, "calendar_work_schedule", **fields).json()["code"] == CHECK_VIOLATION


def test_days_off(supa: Supa) -> None:
    ok = insert(supa, "calendar_days_off", start_date="2026-08-01", end_date="2026-08-14", label="Vacation")
    assert ok.status_code == 201, ok.text
    bad = insert(supa, "calendar_days_off", start_date="2026-08-14", end_date="2026-08-01")
    assert bad.json()["code"] == CHECK_VIOLATION
