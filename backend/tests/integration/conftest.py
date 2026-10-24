"""Fixtures for integration tests against the real Supabase project.

They use the E2E test account from frontend/.env.e2e and skip when it's missing.
Marked `integration` (excluded by `scripts/test.sh --fast`).
"""

import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.auth import get_jwks_client
from app.core.config import get_settings
from app.main import app

E2E_ENV = Path(__file__).resolve().parents[3] / "frontend" / ".env.e2e"


def _load_e2e_env() -> dict[str, str]:
    values = {}
    if E2E_ENV.exists():
        for line in E2E_ENV.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    return {k: os.environ.get(k, values.get(k, "")) for k in ("E2E_EMAIL", "E2E_PASSWORD")}


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if "tests/integration" in str(item.path):
            item.add_marker(pytest.mark.integration)


@dataclass
class Supa:
    """Authenticated httpx client for the Supabase REST and Storage APIs."""

    http: httpx.Client
    user_id: str
    token: str

    def rest(self, method: str, table: str, **kwargs) -> httpx.Response:
        headers = {"Prefer": "return=representation", **kwargs.pop("headers", {})}
        return self.http.request(method, f"/rest/v1/{table}", headers=headers, **kwargs)


@pytest.fixture(scope="session")
def supa() -> Iterator[Supa]:
    creds = _load_e2e_env()
    if not creds["E2E_EMAIL"] or not creds["E2E_PASSWORD"]:
        pytest.skip("No E2E test account (frontend/.env.e2e)")
    settings = get_settings()
    # Same CA bundle as the app (system certs may be missing).
    verify = get_jwks_client().ssl_context
    base = httpx.Client(base_url=settings.supabase_url, headers={"apikey": settings.supabase_anon_key}, verify=verify)
    response = base.post(
        "/auth/v1/token",
        params={"grant_type": "password"},
        json={"email": creds["E2E_EMAIL"], "password": creds["E2E_PASSWORD"]},
    )
    response.raise_for_status()
    session = response.json()
    base.headers["Authorization"] = f"Bearer {session['access_token']}"
    yield Supa(http=base, user_id=session["user"]["id"], token=session["access_token"])
    base.close()


@pytest.fixture
def anon() -> Iterator[httpx.Client]:
    settings = get_settings()
    client = httpx.Client(
        base_url=settings.supabase_url,
        headers={"apikey": settings.supabase_anon_key},
        verify=get_jwks_client().ssl_context,
    )
    yield client
    client.close()


@pytest.fixture
def tag() -> str:
    """Unique prefix for rows created by one test."""
    return f"it-{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
def cleanup(request: pytest.FixtureRequest) -> Iterator[None]:
    """Delete everything the test account created during the test."""
    yield
    if "supa" not in request.fixturenames:
        return
    supa: Supa = request.getfixturevalue("supa")
    for table in (
        "mail_digests",
        "mail_accounts",
        "calendar_task_links",
        "calendar_events",
        "timeline_events",
        "timeline_categories",
        "todo_tasks",
        "todo_routines",
        "calendar_days_off",
        "calendar_work_schedule",
    ):
        supa.rest("DELETE", table, params={"user_id": f"eq.{supa.user_id}"})


@pytest.fixture(autouse=True)
def fake_signing_key() -> None:
    """Overrides the unit-test fixture: integration tests use real Supabase tokens."""


@pytest.fixture
def api(supa: Supa) -> Iterator[TestClient]:
    """The FastAPI app, called as the test account (real token, real database)."""
    with TestClient(app, headers={"Authorization": f"Bearer {supa.token}"}) as client:
        yield client
