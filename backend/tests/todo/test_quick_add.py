import json
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core import claude as claude_core
from app.todo.quick_add import MAX_TASKS, Draft, calendar_context, clean_drafts
from tests.conftest import make_token
from tests.fake_claude import FakeClaude

TODAY = date(2026, 10, 11)  # Sunday


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


def draft(**fields) -> Draft:
    return Draft(**{"title": "Task", **fields})


# --- pure helpers ---------------------------------------------------------------------------


def test_calendar_context_lists_three_weeks_with_weekdays() -> None:
    context = calendar_context("call mum on Friday", TODAY)
    assert context["note"] == "call mum on Friday"
    assert context["calendar"][0] == {"date": "2026-10-11", "weekday": "Sunday"}
    assert context["calendar"][5] == {"date": "2026-10-16", "weekday": "Friday"}
    assert len(context["calendar"]) == 21


def test_clean_drafts_keeps_good_tasks_as_they_are() -> None:
    good = draft(title="Dentysta", planned_date=date(2026, 10, 12), duration_min=60, duration_estimated=True,
                 priority="high", fixed_day=True, notes="o 15:00")
    result = clean_drafts([good], TODAY)
    assert result.tasks == [good]
    assert result.warnings == []


def test_clean_drafts_fixes_dates_and_ranges() -> None:
    result = clean_drafts(
        [
            draft(title="  Past   day ", planned_date=date(2026, 10, 1)),
            draft(title="Old deadline", deadline=date(2026, 10, 1)),
            draft(title="Deadline first", planned_date=date(2026, 10, 20), deadline=date(2026, 10, 14)),
            draft(title="Way too long", duration_min=5000, duration_estimated=True),
            draft(title="Fixed without a day", fixed_day=True),
            draft(title="   "),
        ],
        TODAY,
    )
    by_title = {t.title: t for t in result.tasks}
    assert set(by_title) == {"Past day", "Old deadline", "Deadline first", "Way too long", "Fixed without a day"}
    assert by_title["Past day"].planned_date == TODAY
    assert by_title["Old deadline"].deadline is None
    assert by_title["Deadline first"].planned_date == date(2026, 10, 14)
    assert (by_title["Way too long"].duration_min, by_title["Way too long"].duration_estimated) == (None, False)
    assert by_title["Fixed without a day"].fixed_day is False
    assert len(result.warnings) == 2


def test_clean_drafts_limits_titles_and_count() -> None:
    result = clean_drafts([draft(title="x" * 300)] + [draft(title=f"T{n}") for n in range(30)], TODAY)
    assert len(result.tasks) == MAX_TASKS
    assert len(result.tasks[0].title) == 200
    assert result.warnings == [f"Only the first {MAX_TASKS} tasks were kept."]


# --- route ------------------------------------------------------------------------------------


def test_parse_asks_claude_and_returns_cleaned_drafts(api: TestClient, claude: FakeClaude) -> None:
    claude.reply(
        {
            "tasks": [
                {
                    "title": "Dentysta",
                    "planned_date": "2026-10-12",
                    "deadline": None,
                    "duration_min": 60,
                    "duration_estimated": True,
                    "priority": "high",
                    "fixed_day": True,
                    "notes": "o 15:00",
                },
                {
                    "title": "Oddać raport",
                    "planned_date": None,
                    "deadline": "2026-10-14",
                    "duration_min": None,
                    "duration_estimated": False,
                    "priority": "normal",
                    "fixed_day": False,
                    "notes": "",
                },
            ]
        }
    )
    response = api.post("/todo/parse", json={"text": "dentysta jutro o 15, ważne; raport do środy", "today": "2026-10-11"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [t["title"] for t in body["tasks"]] == ["Dentysta", "Oddać raport"]
    assert body["tasks"][0]["planned_date"] == "2026-10-12" and body["tasks"][0]["duration_estimated"] is True
    assert body["warnings"] == []

    [call] = claude.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["output_config"]["effort"] == "low"
    assert call["fallbacks"] == "default"
    sent = json.loads(call["messages"][0]["content"])
    assert sent["note"] == "dentysta jutro o 15, ważne; raport do środy"
    assert sent["today"] == "2026-10-11"


@pytest.mark.parametrize("body", [{"text": ""}, {"text": "   "}, {"text": "x" * 2001}, {}])
def test_parse_rejects_empty_or_huge_text(api: TestClient, claude: FakeClaude, body: dict) -> None:
    assert api.post("/todo/parse", json=body).status_code == 422
    assert claude.calls == []


def test_parse_without_api_key_is_503(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claude_core, "get_settings", lambda: SimpleNamespace(anthropic_api_key="", anthropic_workspace_id=""))
    assert api.post("/todo/parse", json={"text": "gym"}).status_code == 503


def test_parse_refusal_is_422(api: TestClient, claude: FakeClaude) -> None:
    claude.reply({"tasks": []}, stop_reason="refusal")
    response = api.post("/todo/parse", json={"text": "gym"})
    assert response.status_code == 422
    assert response.json()["detail"] == "Claude declined to make tasks from your note."


def test_parse_requires_a_token(client: TestClient, claude: FakeClaude) -> None:
    assert client.post("/todo/parse", json={"text": "gym"}).status_code == 401
