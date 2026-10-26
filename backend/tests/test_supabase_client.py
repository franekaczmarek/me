import threading

import httpcore
import httpcore._backends.sync as sync_backend
import httpx
import pytest

from app.core import supabase, timing
from app.core.supabase import CONNECT_RETRIES, get_http_client


def test_failed_connections_are_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    """A DNS or connect hiccup is retried before the API answers 503."""
    attempts = []

    def failing_connect(self, *args, **kwargs):
        attempts.append(1)
        raise httpcore.ConnectError("[Errno 8] nodename nor servname provided, or not known")

    monkeypatch.setattr(sync_backend.SyncBackend, "connect_tcp", failing_connect)
    monkeypatch.setattr(sync_backend.SyncBackend, "sleep", lambda self, seconds: None)
    with pytest.raises(httpx.ConnectError):
        get_http_client().get("https://db.invalid/rest/v1/x")
    assert len(attempts) == CONNECT_RETRIES + 1


# --- parallel ---------------------------------------------------------------------------

def test_parallel_runs_calls_at_the_same_time_and_keeps_their_order() -> None:
    both_started = threading.Barrier(2, timeout=5)

    def call(value: str) -> str:
        both_started.wait()  # would time out if the calls ran one after another
        return value

    assert supabase.parallel(lambda: call("a"), lambda: call("b")) == ["a", "b"]


def test_parallel_raises_the_first_error() -> None:
    def boom() -> None:
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        supabase.parallel(lambda: 1, boom)


def test_parallel_calls_count_towards_the_request_timing() -> None:
    db = timing.DbTiming()
    token = timing._current.set(db)
    try:
        supabase.parallel(lambda: timing.record_db(0.1), lambda: timing.record_db(0.2))
    finally:
        timing._current.reset(token)
    assert db.queries == 2
    assert db.seconds == pytest.approx(0.3)


def test_parallel_runs_in_order_when_switched_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(supabase, "PARALLEL", False)
    seen: list[str] = []
    supabase.parallel(lambda: seen.append("a"), lambda: seen.append("b"))
    assert seen == ["a", "b"]
