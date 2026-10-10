"""Timeline schema, constraints and RLS, checked against the real Supabase project."""

import uuid

import httpx

from tests.integration.conftest import Supa

# PostgREST maps Postgres errors to HTTP statuses.
CHECK_VIOLATION = "23514"
UNIQUE_VIOLATION = "23505"
RLS_VIOLATION = "42501"


def make_category(supa: Supa, name: str, color: str = "#3366ff") -> dict:
    response = supa.rest("POST", "timeline_categories", json={"name": name, "color": color})
    assert response.status_code == 201, response.text
    return response.json()[0]


def make_event(supa: Supa, **fields) -> httpx.Response:
    return supa.rest("POST", "timeline_events", json={"title": "Event", "start_date": "2015-06-17", **fields})


# --- access control --------------------------------------------------------


def test_anonymous_users_cannot_read_timeline_data(anon: httpx.Client) -> None:
    for table in ("timeline_events", "timeline_categories", "timeline_event_media", "profiles"):
        response = anon.get(f"/rest/v1/{table}")
        assert response.status_code in (401, 403), f"{table}: {response.status_code} {response.text}"


def test_rows_default_to_the_logged_in_user(supa: Supa, tag: str) -> None:
    category = make_category(supa, tag)
    assert category["user_id"] == supa.user_id


def test_cannot_create_rows_for_another_user(supa: Supa, tag: str) -> None:
    other = str(uuid.uuid4())
    response = supa.rest("POST", "timeline_categories", json={"name": tag, "color": "#000000", "user_id": other})
    assert response.json()["code"] == RLS_VIOLATION
    response = make_event(supa, user_id=other)
    assert response.json()["code"] == RLS_VIOLATION


def test_can_only_see_own_rows(supa: Supa, tag: str) -> None:
    make_category(supa, tag)
    rows = supa.rest("GET", "timeline_categories").json()
    assert rows and all(row["user_id"] == supa.user_id for row in rows)


# --- categories ------------------------------------------------------------


def test_category_color_must_be_hex(supa: Supa, tag: str) -> None:
    for bad in ("red", "#12345", "#gggggg", "123456"):
        response = supa.rest("POST", "timeline_categories", json={"name": f"{tag}{bad}", "color": bad})
        assert response.json()["code"] == CHECK_VIOLATION, bad


def test_category_names_are_unique_per_user_ignoring_case(supa: Supa, tag: str) -> None:
    make_category(supa, f"{tag}-Work")
    response = supa.rest("POST", "timeline_categories", json={"name": f" {tag}-work ", "color": "#000000"})
    assert response.json()["code"] == UNIQUE_VIOLATION


def test_category_name_cannot_be_blank(supa: Supa) -> None:
    response = supa.rest("POST", "timeline_categories", json={"name": "   ", "color": "#000000"})
    assert response.json()["code"] == CHECK_VIOLATION


# --- events ----------------------------------------------------------------


def test_point_event_with_defaults(supa: Supa) -> None:
    response = make_event(supa, title="First day at school")
    assert response.status_code == 201, response.text
    event = response.json()[0]
    assert event["end_date"] is None
    assert event["start_precision"] == "day"
    assert event["description"] == ""
    assert event["category_id"] is None


def test_period_event_with_partial_dates(supa: Supa, tag: str) -> None:
    category = make_category(supa, tag)
    response = make_event(
        supa,
        title="High school",
        category_id=category["id"],
        start_date="2015-01-01",
        start_precision="year",
        end_date="2018-06-01",
        end_precision="month",
    )
    assert response.status_code == 201, response.text


def test_dates_long_before_today_are_allowed(supa: Supa) -> None:
    response = make_event(supa, title="Grandma born", start_date="1931-01-01", start_precision="year")
    assert response.status_code == 201, response.text


def test_event_end_cannot_precede_start(supa: Supa) -> None:
    response = make_event(supa, start_date="2020-05-01", end_date="2019-05-01", end_precision="day")
    assert response.json()["code"] == CHECK_VIOLATION


def test_event_end_date_requires_precision_and_vice_versa(supa: Supa) -> None:
    assert make_event(supa, end_date="2020-01-01").json()["code"] == CHECK_VIOLATION
    assert make_event(supa, end_precision="day").json()["code"] == CHECK_VIOLATION


def test_partial_dates_must_be_normalized(supa: Supa) -> None:
    # Year precision must be Jan 1; month precision must be the 1st.
    assert make_event(supa, start_date="2015-06-01", start_precision="year").json()["code"] == CHECK_VIOLATION
    assert make_event(supa, start_date="2015-06-17", start_precision="month").json()["code"] == CHECK_VIOLATION
    response = make_event(supa, start_date="2015-01-01", end_date="2016-03-05", end_precision="month")
    assert response.json()["code"] == CHECK_VIOLATION


def test_invalid_precision_is_rejected(supa: Supa) -> None:
    assert make_event(supa, start_precision="decade").json()["code"] == CHECK_VIOLATION


def test_event_title_cannot_be_blank(supa: Supa) -> None:
    assert make_event(supa, title="  ").json()["code"] == CHECK_VIOLATION


def test_event_cannot_use_unknown_category(supa: Supa) -> None:
    response = make_event(supa, category_id=str(uuid.uuid4()))
    assert response.json()["code"] == "23503"  # foreign key violation


def test_deleting_a_category_keeps_its_events(supa: Supa, tag: str) -> None:
    category = make_category(supa, tag)
    event = make_event(supa, category_id=category["id"]).json()[0]
    supa.rest("DELETE", "timeline_categories", params={"id": f"eq.{category['id']}"})
    rows = supa.rest("GET", "timeline_events", params={"id": f"eq.{event['id']}"}).json()
    assert rows[0]["category_id"] is None


def test_updated_at_changes_on_update(supa: Supa) -> None:
    event = make_event(supa).json()[0]
    updated = supa.rest("PATCH", "timeline_events", params={"id": f"eq.{event['id']}"}, json={"title": "Renamed"})
    assert updated.json()[0]["updated_at"] > event["updated_at"]


# --- media -----------------------------------------------------------------


def media_row(supa: Supa, event_id: str, folder: str | None = None) -> dict:
    folder = folder or supa.user_id
    media_id = uuid.uuid4()
    return {
        "event_id": event_id,
        "storage_path": f"{folder}/{event_id}/{media_id}-display.webp",
        "thumb_path": f"{folder}/{event_id}/{media_id}-thumb.webp",
    }


def test_media_is_deleted_with_its_event(supa: Supa) -> None:
    event = make_event(supa).json()[0]
    response = supa.rest("POST", "timeline_event_media", json=media_row(supa, event["id"]))
    assert response.status_code == 201, response.text
    supa.rest("DELETE", "timeline_events", params={"id": f"eq.{event['id']}"})
    assert supa.rest("GET", "timeline_event_media", params={"event_id": f"eq.{event['id']}"}).json() == []


def test_media_paths_must_be_in_the_owners_folder(supa: Supa) -> None:
    event = make_event(supa).json()[0]
    row = media_row(supa, event["id"], folder=str(uuid.uuid4()))
    assert supa.rest("POST", "timeline_event_media", json=row).json()["code"] == CHECK_VIOLATION


def test_media_requires_an_existing_own_event(supa: Supa) -> None:
    row = media_row(supa, str(uuid.uuid4()))
    assert supa.rest("POST", "timeline_event_media", json=row).json()["code"] == "23503"


# --- storage ---------------------------------------------------------------

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


def upload(supa: Supa, path: str) -> httpx.Response:
    return supa.http.post(
        f"/storage/v1/object/timeline-media/{path}",
        content=PNG_1PX,
        headers={"Content-Type": "image/png", "x-upsert": "true"},
    )


def test_storage_owner_can_upload_read_and_delete_in_own_folder(supa: Supa, tag: str) -> None:
    path = f"{supa.user_id}/{tag}/photo.png"
    assert upload(supa, path).status_code == 200
    assert supa.http.get(f"/storage/v1/object/authenticated/timeline-media/{path}").content == PNG_1PX
    deleted = supa.http.request("DELETE", "/storage/v1/object/timeline-media", json={"prefixes": [path]})
    assert deleted.status_code == 200 and len(deleted.json()) == 1


def test_storage_rejects_uploads_to_other_users_folders(supa: Supa, tag: str) -> None:
    response = upload(supa, f"{uuid.uuid4()}/{tag}/photo.png")
    assert response.status_code in (400, 403), response.text


def test_storage_bucket_is_private(anon: httpx.Client, supa: Supa, tag: str) -> None:
    path = f"{supa.user_id}/{tag}/photo.png"
    upload(supa, path)
    try:
        assert anon.get(f"/storage/v1/object/public/timeline-media/{path}").status_code in (400, 404)
    finally:
        supa.http.request("DELETE", "/storage/v1/object/timeline-media", json={"prefixes": [path]})


# --- profiles --------------------------------------------------------------


def test_profile_upsert_own_and_not_others(supa: Supa) -> None:
    own = supa.rest(
        "POST",
        "profiles",
        json={"birth_date": "2000-01-01"},
        headers={"Prefer": "return=representation,resolution=merge-duplicates"},
    )
    assert own.status_code in (200, 201), own.text
    assert own.json()[0]["id"] == supa.user_id
    other = supa.rest("POST", "profiles", json={"id": str(uuid.uuid4())})
    assert other.json()["code"] == RLS_VIOLATION
