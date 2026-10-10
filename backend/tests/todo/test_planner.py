import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from app.calendar.capacity import DEFAULT_SCHEDULE
from app.main import app
from app.todo import planner
from app.todo.planner import ClaudePlan, build_context, check_proposal
from app.todo.schemas import Task
from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

TODAY = date(2026, 3, 4)  # Wednesday


def task(title: str, planned: date | None = None, **fields) -> Task:
    data = {
        "id": uuid4(),
        "title": title,
        "notes": "",
        "planned_date": planned,
        "deadline": None,
        "duration_min": 60,
        "priority": "normal",
        "fixed_day": False,
        "status": "open",
        "completed_at": None,
        "first_planned_date": planned,
        "postponed_count": 0,
        "routine_id": None,
        "occurrence_date": None,
        "position": 0,
        "created_at": datetime(2026, 3, 1, tzinfo=UTC),
    }
    return Task(**{**data, **fields})


def day(n: int) -> date:
    return TODAY + timedelta(n)


def plan(*assignments: tuple, summary: str = "A calm week.") -> ClaudePlan:
    return ClaudePlan(
        summary=summary,
        assignments=[{"task_id": str(t.id), "date": d, "reason": r} for t, d, r in assignments],
    )


# --- context ----------------------------------------------------------------------------------


def test_context_lists_days_and_only_movable_tasks() -> None:
    inbox = task("Inbox", None)
    overdue = task("Overdue", day(-2))
    later = task("In the window", day(3))
    fixed = task("Dentist", day(1), fixed_day=True, duration_min=90)
    routine = task("Workout", day(1), routine_id=uuid4(), occurrence_date=day(1), duration_min=None)
    done = task("Done", day(0), status="done", completed_at=datetime(2026, 3, 4, tzinfo=UTC), duration_min=20)
    outside = task("Next month", day(30))

    context = build_context([inbox, overdue, later, fixed, routine, done, outside], TODAY, 7, DEFAULT_SCHEDULE, [])

    assert [d["date"] for d in context["days"]] == [day(n).isoformat() for n in range(7)]
    assert context["days"][0] == {
        "date": "2026-03-04",
        "weekday": "Wednesday",
        "work_day": True,
        "available_min": 180,
        "booked_min": 20,
    }
    # Fixed task + routine (no estimate → 30 min) book Thursday.
    assert context["days"][1]["booked_min"] == 120
    assert context["days"][3]["work_day"] is False and context["days"][3]["available_min"] == 360
    titles = {t["title"]: t for t in context["tasks"]}
    assert set(titles) == {"Inbox", "Overdue", "In the window"}
    assert titles["Overdue"]["overdue"] is True and titles["Inbox"]["current_day"] is None


# --- checking the proposal ---------------------------------------------------------------------


def test_valid_moves_become_ordered_changes() -> None:
    a, b, c = task("A"), task("B"), task("C", day(2))
    tasks = [a, b, c]
    context = build_context(tasks, TODAY, 7, DEFAULT_SCHEDULE, [])
    proposal = check_proposal(
        plan((b, day(1), "Short, fits"), (a, day(1), "After B"), (c, day(2), "Stays")), context, tasks
    )
    assert [(ch.title, ch.to_date, ch.order) for ch in proposal.changes] == [("B", day(1), 0), ("A", day(1), 1)]
    assert proposal.summary == "A calm week."
    assert proposal.warnings == []
    thursday = next(d for d in proposal.days if d.date == day(1))
    assert (thursday.planned_min, thursday.capacity_min) == (120, 180)


def test_invalid_suggestions_are_dropped_with_warnings() -> None:
    a = task("A")
    fixed = task("Fixed", day(1), fixed_day=True)
    tasks = [a, fixed]
    context = build_context(tasks, TODAY, 7, DEFAULT_SCHEDULE, [])
    proposal = check_proposal(
        ClaudePlan(
            summary="x",
            assignments=[
                {"task_id": str(fixed.id), "date": day(3), "reason": "move it"},
                {"task_id": str(uuid4()), "date": day(1), "reason": "made up"},
                {"task_id": str(a.id), "date": day(20), "reason": "too far"},
                {"task_id": str(a.id), "date": day(2), "reason": "duplicate, ignored"},
            ],
        ),
        context,
        tasks,
    )
    assert proposal.changes == []
    assert len(proposal.warnings) == 3
    assert any("outside the planned days" in w for w in proposal.warnings)


def test_moving_to_the_inbox_and_out_of_overdue() -> None:
    overdue = task("Overdue", day(-1))
    low = task("Low", day(2), priority="low")
    tasks = [overdue, low]
    context = build_context(tasks, TODAY, 7, DEFAULT_SCHEDULE, [])
    proposal = check_proposal(plan((overdue, day(0), "Do it today"), (low, None, "No room")), context, tasks)
    moves = {ch.title: (ch.from_date, ch.to_date) for ch in proposal.changes}
    assert moves == {"Overdue": (day(-1), day(0)), "Low": (day(2), None)}


def test_warns_about_deadlines_and_overloaded_days() -> None:
    big = task("Big", duration_min=170)
    due = task("Due", deadline=day(1), duration_min=30)
    tasks = [big, due]
    context = build_context(tasks, TODAY, 7, DEFAULT_SCHEDULE, [])
    proposal = check_proposal(plan((big, day(0), "x"), (due, day(0), "y")), context, tasks)
    assert any("over its available time (200 of 180 min)" in w for w in proposal.warnings)

    proposal = check_proposal(plan((due, day(2), "late")), context, tasks)
    assert any("after its deadline" in w for w in proposal.warnings)


# --- routes --------------------------------------------------------------------------------------


class FakeClaude:
    """Stands in for anthropic.Anthropic: records the request, returns a canned response or raises."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.result: object = None
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def reply(self, data: object, stop_reason: str = "end_turn") -> None:
        text = data if isinstance(data, str) else json.dumps(data)
        self.result = SimpleNamespace(
            stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)], _request_id="req_1"
        )


@pytest.fixture
def claude() -> FakeClaude:
    fake = FakeClaude()
    app.dependency_overrides[planner.get_claude] = lambda: fake
    yield fake
    app.dependency_overrides.pop(planner.get_claude, None)


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


INBOX_ROW = task("Renew passport", deadline=day(5)).model_dump(mode="json")


def queue_planning_data(fake_db: FakeSupabase, rows: list[dict]) -> None:
    fake_db.reply(200, rows)  # tasks
    fake_db.reply(200, [])  # schedule → defaults
    fake_db.reply(200, [])  # days off


def test_client_sends_the_workspace_header_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    planner._client.cache_clear()
    monkeypatch.setattr(planner, "get_settings", lambda: SimpleNamespace(anthropic_api_key="k", anthropic_workspace_id="wrkspc_1"))
    assert planner.get_claude().default_headers["anthropic-workspace-id"] == "wrkspc_1"
    monkeypatch.setattr(planner, "get_settings", lambda: SimpleNamespace(anthropic_api_key="k", anthropic_workspace_id=""))
    assert "anthropic-workspace-id" not in planner.get_claude().default_headers
    planner._client.cache_clear()


def test_plan_without_api_key_is_503(api: TestClient, fake_db: FakeSupabase, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(planner, "get_settings", lambda: SimpleNamespace(anthropic_api_key="", anthropic_workspace_id=""))
    response = api.post("/todo/plan", json={"today": "2026-03-04"})
    assert response.status_code == 503
    assert "isn't set up" in response.json()["detail"]


def test_plan_asks_claude_and_returns_a_checked_proposal(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude) -> None:
    queue_planning_data(fake_db, [INBOX_ROW])
    claude.reply(
        {"summary": "Passport first.", "assignments": [{"task_id": INBOX_ROW["id"], "date": "2026-03-05", "reason": "Deadline soon"}]}
    )
    response = api.post("/todo/plan", json={"today": "2026-03-04", "days": 7})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"] == "Passport first."
    assert body["changes"] == [
        {
            "task_id": INBOX_ROW["id"],
            "title": "Renew passport",
            "from_date": None,
            "to_date": "2026-03-05",
            "order": 0,
            "duration_min": 60,
            "reason": "Deadline soon",
        }
    ]
    [call] = claude.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"]["effort"] == "medium"
    assert call["output_config"]["format"]["type"] == "json_schema"
    context = json.loads(call["messages"][0]["content"])
    assert context["tasks"][0]["title"] == "Renew passport"
    assert len(context["days"]) == 7


def test_plan_with_nothing_movable_skips_claude(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude) -> None:
    queue_planning_data(fake_db, [])
    response = api.post("/todo/plan", json={"today": "2026-03-04"})
    assert response.status_code == 200
    assert response.json()["changes"] == []
    assert claude.calls == []


@pytest.mark.parametrize(
    ("setup", "expected"),
    [
        (lambda c: c.reply({"summary": "", "assignments": []}, stop_reason="refusal"), 422),
        (lambda c: c.reply("{not json", stop_reason="end_turn"), 502),
        (lambda c: c.reply("{}", stop_reason="max_tokens"), 502),
    ],
)
def test_plan_handles_bad_responses(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude, setup, expected: int) -> None:
    queue_planning_data(fake_db, [INBOX_ROW])
    setup(claude)
    assert api.post("/todo/plan", json={"today": "2026-03-04"}).status_code == expected


def _api_error(cls, status_code: int):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("boom", response=httpx.Response(status_code, request=request), body=None)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (_api_error(anthropic.AuthenticationError, 401), 503),
        (_api_error(anthropic.RateLimitError, 429), 429),
        (_api_error(anthropic.InternalServerError, 500), 502),
        (anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com")), 503),
    ],
)
def test_plan_maps_claude_errors(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude, error, expected: int) -> None:
    queue_planning_data(fake_db, [INBOX_ROW])
    claude.result = error
    assert api.post("/todo/plan", json={"today": "2026-03-04"}).status_code == expected


@pytest.mark.parametrize("days", [0, 15])
def test_plan_days_are_limited(api: TestClient, fake_db: FakeSupabase, claude: FakeClaude, days: int) -> None:
    assert api.post("/todo/plan", json={"days": days}).status_code == 422


def test_apply_moves_only_accepted_movable_tasks(api: TestClient, fake_db: FakeSupabase) -> None:
    first, second = str(uuid4()), str(uuid4())
    fake_db.reply(200, [{"id": first}])
    fake_db.reply(200, [])  # e.g. completed meanwhile: not moved
    response = api.post(
        "/todo/plan/apply",
        json={
            "today": "2026-03-04",
            "changes": [{"task_id": first, "to_date": "2026-03-05", "order": 1}, {"task_id": second, "to_date": None}],
        },
    )
    assert response.json() == {"applied": 1}
    patch = fake_db.requests[0]
    assert patch.url.params["status"] == "eq.open"
    assert patch.url.params["fixed_day"] == "eq.false"
    assert patch.url.params["routine_id"] == "is.null"
    assert json.loads(patch.content) == {"planned_date": "2026-03-05", "position": 1}
    assert json.loads(fake_db.requests[1].content) == {"planned_date": None, "position": 0}


def test_apply_rejects_past_days(api: TestClient, fake_db: FakeSupabase) -> None:
    response = api.post(
        "/todo/plan/apply", json={"today": "2026-03-04", "changes": [{"task_id": str(UUID(int=1)), "to_date": "2026-03-01"}]}
    )
    assert response.status_code == 422
    assert fake_db.requests == []
