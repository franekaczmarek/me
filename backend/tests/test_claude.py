from types import SimpleNamespace

import pytest

from app.core import claude


def test_client_sends_the_workspace_header_only_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    claude._client.cache_clear()
    monkeypatch.setattr(claude, "get_settings", lambda: SimpleNamespace(anthropic_api_key="k", anthropic_workspace_id="wrkspc_1"))
    assert claude.get_claude(None).default_headers["anthropic-workspace-id"] == "wrkspc_1"
    monkeypatch.setattr(claude, "get_settings", lambda: SimpleNamespace(anthropic_api_key="k", anthropic_workspace_id=""))
    assert "anthropic-workspace-id" not in claude.get_claude(None).default_headers
    claude._client.cache_clear()


def test_missing_key_is_a_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claude, "get_settings", lambda: SimpleNamespace(anthropic_api_key="", anthropic_workspace_id=""))
    with pytest.raises(Exception) as info:
        claude.get_claude(None)
    assert info.value.status_code == 503
