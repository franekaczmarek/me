"""Stand-in for the Anthropic client used by the Claude-backed endpoints."""

import json
from collections.abc import Iterator
from types import SimpleNamespace

import pytest

from app.core.auth import CurrentUserDep
from app.core.claude import get_claude
from app.main import app


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
def claude() -> Iterator[FakeClaude]:
    fake = FakeClaude()
    # Keeps the real login check: the fake replaces only the API client.
    def override(user: CurrentUserDep) -> FakeClaude:
        return fake

    app.dependency_overrides[get_claude] = override
    yield fake
    app.dependency_overrides.pop(get_claude, None)
