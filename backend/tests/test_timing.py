import re

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.timing import DbTiming, record_db, server_timing
from tests.conftest import make_token
from tests.fake_supabase import FakeSupabase

TIMING = re.compile(r'^db;dur=[\d.]+;desc="(\d+) queries", total;dur=[\d.]+$')


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client


def queries(response: httpx.Response) -> int:
    match = TIMING.match(response.headers["Server-Timing"])
    assert match, response.headers["Server-Timing"]
    return int(match.group(1))


def test_header_without_database_calls(client: TestClient) -> None:
    response = client.get("/health")
    assert queries(response) == 0
    assert response.headers["Timing-Allow-Origin"] == "*"


def test_counts_supabase_calls_of_a_sync_route(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"display_name": "A", "birth_date": None}])
    assert queries(api.get("/profile")) == 1


def test_counts_failed_calls_and_errors_keep_the_header(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.fail(httpx.ConnectError("down"))
    response = api.get("/profile")
    assert response.status_code == 503
    assert queries(response) == 1


def test_requests_do_not_share_counts(api: TestClient, fake_db: FakeSupabase) -> None:
    fake_db.reply(200, [{"display_name": "A", "birth_date": None}])
    api.get("/profile")
    fake_db.reply(200, [{"display_name": "A", "birth_date": None}])
    assert queries(api.get("/profile")) == 1


def test_record_outside_a_request_is_ignored() -> None:
    record_db(1.0)  # no error


def test_format() -> None:
    assert server_timing(DbTiming(queries=3, seconds=0.25), 0.5) == 'db;dur=250.0;desc="3 queries", total;dur=500.0'
