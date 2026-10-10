"""Stand-in for the Supabase REST API: records requests and replies with queued responses."""

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from app.core.supabase import get_http_client
from app.main import app


class FakeSupabase:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self._replies: list[httpx.Response | Exception] = []

    def reply(self, status: int = 200, body: Any = None) -> None:
        self._replies.append(httpx.Response(status, json=[] if body is None else body))

    def fail(self, exc: Exception) -> None:
        self._replies.append(exc)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        reply = self._replies.pop(0) if self._replies else httpx.Response(200, json=[])
        if isinstance(reply, Exception):
            raise reply
        return reply

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1]

    @property
    def last_json(self) -> Any:
        return json.loads(self.last.content)


@pytest.fixture
def fake_db() -> Iterator[FakeSupabase]:
    fake = FakeSupabase()
    http = httpx.Client(base_url="https://db.test", transport=httpx.MockTransport(fake.handle))
    app.dependency_overrides[get_http_client] = lambda: http
    yield fake
    app.dependency_overrides.pop(get_http_client, None)
