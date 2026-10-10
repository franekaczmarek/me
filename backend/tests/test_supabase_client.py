import httpcore
import httpcore._backends.sync as sync_backend
import httpx
import pytest

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
