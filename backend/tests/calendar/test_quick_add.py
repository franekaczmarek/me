from datetime import date, time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.calendar.quick_add import ClaudeEvent, clean_events
from app.core import claude as claude_core
from tests.conftest import make_token
from tests.fake_claude import FakeClaude
from tests.fake_supabase import FakeSupabase

DAY = date(2026, 10, 15)


def raw(title: str = "Dentysta", **fields) -> ClaudeEvent:
    return ClaudeEvent(**{"title": title, "start_date": DAY, "end_date": DAY, **fields})


def test_clean_keeps_good_events() -> None:
    result = clean_events([raw(start_time="15:30", end_time="16:15", kind="appointment", location=" Clinic  A ")])
    [event] = result.events
    assert (event.start_time, event.end_time, event.end_date) == (time(15, 30), time(16, 15), DAY)
    assert (event.color, event.location, event.recurrence) == ("#56a8f5", "Clinic A", "none")
    assert result.warnings == []


def test_clean_fixes_times_and_dates() -> None:
    no_end, backwards, late, bad, end_only, swapped = clean_events(
        [
            raw(start_time="15:30"),
            raw(start_time="15:30", end_time="09:00"),
            raw(start_time="23:30"),
            raw(start_time="half past three"),
            raw(end_time="10:00"),
            raw("Trip", end_date=date(2026, 10, 10), kind="trip"),
        ]
    ).events
    assert (no_end.end_time, backwards.end_time) == (time(16, 30), time(16, 30))
    assert (late.end_date, late.end_time) == (date(2026, 10, 16), time(0, 30))
    assert (bad.start_time, bad.end_time) == (None, None)
    assert (end_only.start_time, end_only.end_time) == (None, None)
    assert (swapped.end_date, swapped.color) == (DAY, "#4cc9a0")


def test_clean_drops_empty_titles_and_limits_count() -> None:
    result = clean_events([raw("  ")] + [raw(f"E{i}") for i in range(12)])
    assert len(result.events) == 10
    assert result.warnings == ["Only the first 10 events were kept."]


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


def test_parse_asks_claude(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude) -> None:
    claude.reply(
        {
            "events": [
                {
                    "title": "Urodziny Kasi",
                    "start_date": "2027-03-03",
                    "end_date": "2027-03-03",
                    "start_time": None,
                    "end_time": None,
                    "recurrence": "yearly",
                    "kind": "birthday",
                    "location": "",
                    "notes": "",
                }
            ]
        }
    )
    response = api.post("/calendar/parse", json={"text": "urodziny Kasi 3 marca co roku", "today": "2026-10-11"})
    assert response.status_code == 200
    assert response.json()["events"] == [
        {
            "title": "Urodziny Kasi",
            "start_date": "2027-03-03",
            "end_date": "2027-03-03",
            "start_time": None,
            "end_time": None,
            "recurrence": "yearly",
            "color": "#f27fb2",
            "location": "",
            "notes": "",
        }
    ]
    [call] = claude.calls
    assert call["model"] == "claude-opus-5-5" and call["output_config"]["effort"] == "low"
    assert '"today": "2026-10-11"' in call["messages"][0]["content"]
    assert fake_db.requests == []


@pytest.mark.parametrize("body", [{"text": "  "}, {"text": "x" * 2001}])
def test_parse_rejects_empty_or_huge_text(api: TestClient, claude: FakeClaude, body: dict) -> None:
    assert api.post("/calendar/parse", json=body).status_code == 422
    assert claude.calls == []


def test_parse_without_api_key_is_503(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claude_core, "get_settings", lambda: SimpleNamespace(anthropic_api_key="", anthropic_workspace_id=""))
    assert api.post("/calendar/parse", json={"text": "dentist friday"}).status_code == 503
