import json
from datetime import date, time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.calendar.schemas import Event, to_occurrence
from app.calendar.suggest import ClaudeSuggestion, build_context, check_suggestions, title_key
from app.core import claude as claude_core
from tests.conftest import make_token
from tests.fake_claude import FakeClaude
from tests.fake_supabase import FakeSupabase

TODAY = date(2026, 10, 11)


def occ(title: str, start: date, times: tuple[time, time] | None = None, **fields):
    event = Event(
        id=uuid4(),
        title=title,
        start_date=start,
        end_date=start,
        start_time=times[0] if times else None,
        end_time=times[1] if times else None,
        **fields,
    )
    return to_occurrence(event, event.span())


BIRTHDAY = occ("Urodziny mamy", date(2026, 10, 25), recurrence="yearly", color="#f27fb2")
DOCTOR = occ("Lekarz", date(2026, 10, 14), (time(15, 30), time(16, 30)), location="Clinic")
FOUND = [DOCTOR, BIRTHDAY]


def raw(ref: str, title: str, days_before: int = 0, **fields) -> ClaudeSuggestion:
    return ClaudeSuggestion(event_ref=ref, title=title, days_before=days_before, **fields)


def test_title_key() -> None:
    assert title_key("  Kup prezent dla Mamy! ") == "kup prezent dla mamy"
    assert title_key("Doctor visit, 15:30") == "doctor visit 15 30"


def test_context_lists_events_with_what_was_handled() -> None:
    handled = {(str(BIRTHDAY.id), BIRTHDAY.occurrence_date): {"kup kwiaty"}}
    context = build_context(FOUND, TODAY, handled)
    doctor, birthday = context["events"]
    assert doctor == {
        "ref": "e0",
        "title": "Lekarz",
        "date": "2026-10-14",
        "weekday": "Wednesday",
        "time": "15:30–16:30",
        "last_day": None,
        "days_until": 3,
        "repeats": "none",
        "location": "Clinic",
        "notes": "",
        "already_handled": [],
    }
    assert birthday["already_handled"] == ["kup kwiaty"]
    assert birthday["time"] is None and birthday["repeats"] == "yearly"


def test_check_places_tasks_before_the_event() -> None:
    result = check_suggestions(
        [
            raw("e1", "Kup prezent dla mamy", 10, duration_min=60, priority="normal", deadline_is_event=True, reason="Czas na zakupy"),
            raw("e0", "Wizyta u lekarza 15:30", 0, duration_min=90),
        ],
        FOUND,
        TODAY,
        {},
    )
    present, visit = sorted(result.suggestions, key=lambda s: s.title)
    assert (present.planned_date, present.deadline, present.fixed_day, present.event_title) == (
        date(2026, 10, 15),
        date(2026, 10, 25),
        False,
        "Urodziny mamy",
    )
    assert (visit.planned_date, visit.deadline, visit.fixed_day) == (date(2026, 10, 14), None, True)
    assert result.events == 2 and result.warnings == []
    assert [s.title for s in result.suggestions] == ["Wizyta u lekarza 15:30", "Kup prezent dla mamy"]


def test_check_clamps_dates_and_ranges() -> None:
    result = check_suggestions(
        [raw("e0", "Get the referral", 30, duration_min=5000), raw("e1", "After the party", -3)], FOUND, TODAY, {}
    )
    referral, after = result.suggestions
    assert referral.planned_date == TODAY and referral.duration_min is None
    assert after.planned_date == BIRTHDAY.start_date


def test_check_drops_repeats_unknown_events_and_extras() -> None:
    handled = {(str(BIRTHDAY.id), BIRTHDAY.occurrence_date): {"kup kwiaty"}}
    result = check_suggestions(
        [
            raw("e1", "Kup kwiaty!", 1),
            raw("e1", "Kup prezent", 5),
            raw("e1", "kup  PREZENT", 4),
            raw("e1", "Zamów tort", 3),
            raw("e1", "Napisz kartkę", 2),
            raw("e1", "Zarezerwuj stolik", 2),
            raw("e9", "Ghost", 1),
            raw("e0", "   ", 0),
        ],
        FOUND,
        TODAY,
        handled,
    )
    assert [s.title for s in result.suggestions] == ["Kup prezent", "Zamów tort", "Napisz kartkę"]
    assert result.warnings == ["Ignored a suggestion for an unknown event."]


# --- endpoints -----------------------------------------------------------------------


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


def event_row(o) -> dict:
    return {**o.model_dump(mode="json", exclude={"all_day", "occurrence_date"})}


def test_suggest_asks_claude_about_the_next_30_days(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude) -> None:
    fake_db.reply(200, [event_row(DOCTOR), event_row(BIRTHDAY)])
    fake_db.reply(200, [{"event_id": str(BIRTHDAY.id), "occurrence_date": "2026-10-25", "title_key": "kup kwiaty"}])
    claude.reply({"suggestions": [{"event_ref": "e1", "title": "Kup prezent dla mamy", "days_before": 10, "duration_min": 60, "priority": "normal", "deadline_is_event": True, "reason": "Na czas"}]})
    response = api.post("/calendar/suggest", json={"today": "2026-10-11"})
    assert response.status_code == 200
    body = response.json()
    assert [(s["title"], s["planned_date"], s["event_color"]) for s in body["suggestions"]] == [
        ("Kup prezent dla mamy", "2026-10-15", "#f27fb2")
    ]
    assert body["events"] == 2
    assert fake_db.requests[0].url.params["start_date"] == "lte.2026-11-10"
    assert fake_db.requests[1].url.params["and"] == "(occurrence_date.gte.2026-10-11,occurrence_date.lte.2026-11-10)"
    [call] = claude.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default"
    assert call["output_config"]["effort"] == "low"
    assert "kup kwiaty" in call["messages"][0]["content"]


def test_suggest_without_events_skips_claude(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude) -> None:
    fake_db.reply(200, [])
    assert api.post("/calendar/suggest", json={"today": "2026-10-11"}).json() == {"suggestions": [], "events": 0, "warnings": []}
    assert claude.calls == []


def test_suggest_without_api_key_is_503(api: TestClient, fake_db: FakeSupabase, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claude_core, "get_settings", lambda: SimpleNamespace(anthropic_api_key="", anthropic_workspace_id=""))
    assert api.post("/calendar/suggest", json={}).status_code == 503


def test_suggest_refusal_is_422(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude) -> None:
    fake_db.reply(200, [event_row(DOCTOR)])
    claude.reply({"suggestions": []}, stop_reason="refusal")
    assert api.post("/calendar/suggest", json={"today": "2026-10-11"}).status_code == 422


def test_apply_creates_linked_tasks_and_remembers_choices(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(201, [{"id": "t1"}])
    body = {
        "today": "2026-10-11",
        "accepted": [
            {
                "event_id": str(BIRTHDAY.id),
                "occurrence_date": "2026-10-25",
                "suggested_title": "Kup prezent dla mamy",
                "title": "Kup książkę dla mamy",
                "planned_date": "2026-10-15",
                "deadline": "2026-10-25",
                "duration_min": 60,
            }
        ],
        "dismissed": [{"event_id": str(DOCTOR.id), "occurrence_date": "2026-10-14", "suggested_title": "Weź skierowanie"}],
    }
    response = api.post("/calendar/suggest/apply", json=body)
    assert response.json() == {"created": 1, "dismissed": 1}
    task, accepted, dismissed = fake_db.requests
    assert task.url.path.endswith("/todo_tasks")
    assert json.loads(task.content) == {
        "title": "Kup książkę dla mamy",
        "planned_date": "2026-10-15",
        "deadline": "2026-10-25",
        "duration_min": 60,
        "priority": "normal",
        "fixed_day": False,
        "source_event_id": str(BIRTHDAY.id),
        "source_occurrence_date": "2026-10-25",
    }
    assert json.loads(accepted.content) == {
        "event_id": str(BIRTHDAY.id),
        "occurrence_date": "2026-10-25",
        "title_key": "kup prezent dla mamy",
        "status": "accepted",
        "task_id": "t1",
    }
    assert accepted.url.params["on_conflict"] == "event_id,occurrence_date,title_key"
    assert json.loads(dismissed.content)["status"] == "dismissed"


def test_apply_rejects_past_days(api: TestClient, fake_db: FakeSupabase) -> None:
    body = {
        "today": "2026-10-11",
        "accepted": [
            {"event_id": str(DOCTOR.id), "occurrence_date": "2026-10-14", "suggested_title": "x", "title": "x", "planned_date": "2026-10-10"}
        ],
    }
    assert api.post("/calendar/suggest/apply", json=body).status_code == 422
    assert fake_db.requests == []
