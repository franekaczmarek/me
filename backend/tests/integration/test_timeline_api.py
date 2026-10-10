"""Timeline API end to end: FastAPI -> Supabase with the test account's real token."""

import uuid

from fastapi.testclient import TestClient

from tests.integration.conftest import Supa


def create_category(api: TestClient, name: str, color: str = "#3366ff") -> dict:
    response = api.post("/timeline/categories", json={"name": name, "color": color})
    assert response.status_code == 201, response.text
    return response.json()


def create_event(api: TestClient, **fields) -> dict:
    response = api.post("/timeline/events", json={"title": "Event", "start": "2015-06-17", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_category_crud(api: TestClient, tag: str) -> None:
    category = create_category(api, f" {tag} ", "#AABBCC")
    assert (category["name"], category["color"]) == (tag, "#aabbcc")
    assert category in api.get("/timeline/categories").json()

    response = api.patch(f"/timeline/categories/{category['id']}", json={"name": f"{tag}-renamed"})
    assert response.status_code == 200
    assert response.json()["name"] == f"{tag}-renamed"

    assert api.delete(f"/timeline/categories/{category['id']}").status_code == 204
    assert all(c["id"] != category["id"] for c in api.get("/timeline/categories").json())
    assert api.delete(f"/timeline/categories/{category['id']}").status_code == 404


def test_duplicate_category_name_is_409(api: TestClient, tag: str) -> None:
    create_category(api, tag)
    assert api.post("/timeline/categories", json={"name": tag.upper(), "color": "#000000"}).status_code == 409


def test_event_crud_with_partial_dates(api: TestClient, tag: str) -> None:
    category = create_category(api, tag)
    event = create_event(api, title=tag, start="2015", end="2018-06", category_id=category["id"], description="Hi")
    assert (event["start"], event["end"], event["category_id"]) == ("2015", "2018-06", category["id"])

    assert api.get(f"/timeline/events/{event['id']}").json() == event
    assert event in api.get("/timeline/events").json()

    response = api.patch(f"/timeline/events/{event['id']}", json={"end": None, "start": "2015-09-01"})
    assert response.status_code == 200
    updated = response.json()
    assert (updated["start"], updated["end"], updated["title"]) == ("2015-09-01", None, tag)

    assert api.delete(f"/timeline/events/{event['id']}").status_code == 204
    assert api.get(f"/timeline/events/{event['id']}").status_code == 404


def test_events_are_listed_chronologically(api: TestClient, tag: str) -> None:
    create_event(api, title=f"{tag}-b", start="2001")
    create_event(api, title=f"{tag}-a", start="1931-02-28")
    titles = [e["title"] for e in api.get("/timeline/events").json() if e["title"].startswith(tag)]
    assert titles == [f"{tag}-a", f"{tag}-b"]


def test_event_with_unknown_category_is_422(api: TestClient) -> None:
    response = api.post("/timeline/events", json={"title": "x", "start": "2015", "category_id": str(uuid.uuid4())})
    assert response.status_code == 422


def test_patch_end_before_stored_start_is_422(api: TestClient) -> None:
    event = create_event(api, start="2015")
    assert api.patch(f"/timeline/events/{event['id']}", json={"end": "1990"}).status_code == 422


def test_deleting_category_keeps_its_events(api: TestClient, tag: str) -> None:
    category = create_category(api, tag)
    event = create_event(api, category_id=category["id"])
    assert api.delete(f"/timeline/categories/{category['id']}").status_code == 204
    assert api.get(f"/timeline/events/{event['id']}").json()["category_id"] is None


def test_rows_created_via_api_belong_to_the_user(api: TestClient, supa: Supa) -> None:
    event = create_event(api)
    [row] = supa.rest("GET", "timeline_events", params={"id": f"eq.{event['id']}", "select": "user_id"}).json()
    assert row["user_id"] == supa.user_id


def test_unknown_ids_are_404(api: TestClient) -> None:
    missing = uuid.uuid4()
    assert api.get(f"/timeline/events/{missing}").status_code == 404
    assert api.patch(f"/timeline/events/{missing}", json={"title": "x"}).status_code == 404
    assert api.patch(f"/timeline/categories/{missing}", json={"name": "x"}).status_code == 404
