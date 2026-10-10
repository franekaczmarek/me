"""Profile API against the real Supabase project."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from tests.integration.conftest import Supa


@pytest.fixture(autouse=True)
def no_profile(supa: Supa) -> Iterator[None]:
    """Each test starts and ends without a profile row for the test account."""
    supa.rest("DELETE", "profiles", params={"id": f"eq.{supa.user_id}"})
    yield
    supa.rest("DELETE", "profiles", params={"id": f"eq.{supa.user_id}"})


def test_profile_is_empty_until_first_update(api: TestClient) -> None:
    assert api.get("/profile").json() == {"display_name": None, "birth_date": None}


def test_updates_create_then_merge_the_profile(api: TestClient, supa: Supa) -> None:
    assert api.patch("/profile", json={"birth_date": "1990-03-04"}).json() == {
        "display_name": None,
        "birth_date": "1990-03-04",
    }
    # Second update keeps the birth date.
    assert api.patch("/profile", json={"display_name": "Tester"}).json() == {
        "display_name": "Tester",
        "birth_date": "1990-03-04",
    }
    assert api.get("/profile").json()["display_name"] == "Tester"
    [row] = supa.rest("GET", "profiles", params={"select": "id"}).json()
    assert row["id"] == supa.user_id


def test_clearing_birth_date(api: TestClient) -> None:
    api.patch("/profile", json={"birth_date": "1990-03-04"})
    assert api.patch("/profile", json={"birth_date": None}).json()["birth_date"] is None
