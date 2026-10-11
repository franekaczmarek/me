from datetime import date, time

import pytest
from fastapi.testclient import TestClient

from app.calendar.capacity import DayOff
from app.calendar.schemas import Event, Occurrence, to_occurrence
from app.calendar.summary import summarize_month, upcoming
from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

TODAY = date(2026, 10, 11)


def occ(title: str, start: date, end: date | None = None, times: tuple[time, time] | None = None, id_: int = 1) -> Occurrence:
    event = Event(
        id=f"00000000-0000-0000-0000-{id_:012d}",
        title=title,
        start_date=start,
        end_date=end or start,
        start_time=times[0] if times else None,
        end_time=times[1] if times else None,
    )
    return to_occurrence(event, event.span())


def test_month_summary() -> None:
    found = [
        occ("Trip", date(2026, 9, 29), date(2026, 10, 2)),
        occ("Doctor", date(2026, 10, 2), times=(time(15, 30), time(17))),
        occ("Late", date(2026, 10, 31), date(2026, 11, 1), times=(time(23), time(1))),
    ]
    tasks = [
        {"planned_date": "2026-10-01", "status": "open"},
        {"planned_date": "2026-10-11", "status": "open"},
        {"planned_date": "2026-10-03", "status": "done"},
        {"planned_date": "2026-10-04", "status": "missed"},
    ]
    days_off = [DayOff(date(2026, 9, 30), date(2026, 10, 3))]
    summary = summarize_month(date(2026, 10, 1), found, days_off, tasks, TODAY)
    assert summary.model_dump() == {
        "month": date(2026, 10, 1),
        "events": 3,
        "event_minutes": 90 + 60,
        "busiest_day": date(2026, 10, 2),
        "busiest_day_events": 2,
        "days_off": 3,
        "tasks_done": 1,
        "tasks_open": 2,
        "tasks_overdue": 1,
    }


def test_empty_month() -> None:
    summary = summarize_month(date(2026, 2, 1), [], [], [], TODAY)
    assert (summary.events, summary.busiest_day, summary.busiest_day_events, summary.days_off) == (0, None, 0, 0)


def test_upcoming() -> None:
    running = occ("Trip", date(2026, 10, 9), date(2026, 10, 12), id_=1)
    birthday = occ("Mom's birthday", date(2026, 10, 25), id_=2)
    past = occ("Past", date(2026, 10, 1), id_=3)
    far = occ("Far", date(2026, 11, 11), id_=4)
    gym = [occ("Gym", date(2026, 10, day), id_=5) for day in (12, 19, 26)]
    found = upcoming([past, running, gym[0], gym[1], birthday, gym[2], far], TODAY, {(str(birthday.id), "2026-10-25")})
    assert [(u.title, u.days_until, u.has_task) for u in found] == [
        ("Trip", 0, False),
        ("Gym", 1, False),
        ("Mom's birthday", 14, True),
    ]


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


def test_summary_endpoint(api: TestClient, fake_db: FakeSupabase) -> None:
    birthday = {
        "id": "00000000-0000-0000-0000-000000000002",
        "title": "Mom's birthday",
        "notes": "",
        "location": "",
        "start_date": "1965-10-25",
        "end_date": "1965-10-25",
        "start_time": None,
        "end_time": None,
        "color": "#f27fb2",
        "recurrence": "yearly",
        "recurrence_until": None,
        "add_to_timeline": False,
        "timeline_event_id": None,
    }
    fake_db.reply(200, [birthday])  # events
    fake_db.reply(200, [{"planned_date": "2026-10-20", "status": "done"}])  # tasks
    fake_db.reply(200, [])  # days off
    fake_db.reply(200, [{"source_event_id": birthday["id"], "source_occurrence_date": "2026-10-25"}])  # links
    response = api.get("/calendar/summary", params={"month": "2026-10-17", "today": "2026-10-11"})
    assert response.status_code == 200
    body = response.json()
    assert body["month"]["month"] == "2026-10-01"
    assert (body["month"]["events"], body["month"]["tasks_done"]) == (1, 1)
    assert [(u["title"], u["days_until"], u["has_task"]) for u in body["upcoming"]] == [("Mom's birthday", 14, True)]
    events_query = fake_db.requests[0].url.params
    assert (events_query["start_date"], events_query["or"]) == (
        "lte.2026-11-10",
        "(recurrence.neq.none,end_date.gte.2026-10-01)",
    )
    assert fake_db.requests[1].url.params["and"] == "(planned_date.gte.2026-10-01,planned_date.lte.2026-10-31)"
    assert fake_db.requests[3].url.params["and"] == (
        "(source_occurrence_date.gte.2026-10-11,source_occurrence_date.lte.2026-11-10)"
    )


def test_summary_needs_today(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get("/calendar/summary", params={"month": "2026-10-01"}).status_code == 422
