"""Mail: schema, RLS and the inbox API against the real Supabase project (Gmail itself is faked)."""

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.mail.crypto import Cipher
from app.mail.imap import RawMail
from tests.fake_claude import FakeClaude
from tests.fake_gmail import MAIL_KEY, FakeGmail, raw_mail
from tests.integration.conftest import Supa

CHECK_VIOLATION = "23514"
RLS_VIOLATION = "42501"


def insert(supa: Supa, table: str, **fields) -> httpx.Response:
    return supa.rest("POST", table, json=fields)


def account(supa: Supa, email: str = "me@gmail.com") -> dict:
    response = insert(supa, "mail_accounts", email=email, password_enc="secret")
    assert response.status_code == 201, response.text
    return response.json()[0]


@pytest.mark.parametrize("table", ["mail_accounts", "mail_digests", "mail_messages"])
def test_anonymous_users_cannot_read(anon: httpx.Client, table: str) -> None:
    assert anon.get(f"/rest/v1/{table}").status_code in (401, 403)


def test_accounts_belong_to_the_logged_in_user(supa: Supa) -> None:
    response = insert(supa, "mail_accounts", email="me@gmail.com", password_enc="x", user_id=str(uuid.uuid4()))
    assert response.json()["code"] == RLS_VIOLATION


@pytest.mark.parametrize(
    "change", [{"email": "Me@gmail.com"}, {"email": "nope"}, {"color": "#FFFFFF"}, {"password_enc": ""}]
)
def test_account_constraints(supa: Supa, change: dict) -> None:
    row = {"email": "me@gmail.com", "password_enc": "x", **change}
    assert insert(supa, "mail_accounts", **row).json()["code"] == CHECK_VIOLATION


def test_deleting_an_account_removes_its_mail_and_unlinks_tasks(supa: Supa) -> None:
    acc = account(supa)
    digest = insert(supa, "mail_digests", summary="One email").json()[0]
    message = insert(
        supa,
        "mail_messages",
        account_id=acc["id"],
        digest_id=digest["id"],
        uidvalidity=1,
        uid=7,
        message_id="<a@b>",
        category="updates",
    ).json()[0]
    duplicate = insert(
        supa, "mail_messages", account_id=acc["id"], digest_id=digest["id"], uidvalidity=1, uid=8, message_id="<a@b>"
    )
    assert duplicate.status_code == 409
    task = insert(supa, "todo_tasks", title="Reply", source_mail_id=message["id"]).json()[0]

    supa.rest("DELETE", "mail_accounts", params={"id": f"eq.{acc['id']}"})
    assert supa.rest("GET", "mail_messages", params={"id": f"eq.{message['id']}"}).json() == []
    kept = supa.rest("GET", "todo_tasks", params={"id": f"eq.{task['id']}"}).json()[0]
    assert kept["source_mail_id"] is None


def test_api_saves_an_inbox_with_the_password_encrypted(api: TestClient, supa: Supa, gmail: FakeGmail) -> None:
    created = api.post("/mail/accounts", json={"email": "Me@Gmail.com", "app_password": "abcd efgh ijkl mnop"})
    assert created.status_code == 201, created.text
    assert "password_enc" not in created.json()
    assert api.post("/mail/accounts", json={"email": "me@gmail.com", "app_password": "x"}).status_code == 409

    stored = supa.rest("GET", "mail_accounts", params={"id": f"eq.{created.json()['id']}"}).json()[0]
    assert Cipher(MAIL_KEY).decrypt(stored["password_enc"]) == "abcdefghijklmnop"

    updated = api.patch(f"/mail/accounts/{stored['id']}", json={"label": "Private"})
    assert updated.json()["label"] == "Private"
    assert [a["email"] for a in api.get("/mail/accounts").json()] == ["me@gmail.com"]
    assert api.delete(f"/mail/accounts/{stored['id']}").status_code == 204
    assert api.get("/mail/accounts").json() == []


def test_digest_is_saved_once_per_email(api: TestClient, supa: Supa, gmail: FakeGmail, claude: FakeClaude) -> None:
    created = api.post("/mail/accounts", json={"email": "me@gmail.com", "app_password": "x", "label": "Private"})
    assert created.status_code == 201, created.text
    gmail.add(
        "me@gmail.com",
        RawMail(9, "primary", raw_mail("Invoice", "Pay 120 PLN by 30.10", message_id="<inv,(1)@x>")),
        RawMail(12, "promotions", raw_mail("Sale")),
        uidvalidity=77,
    )
    claude.reply(
        {
            "summary": "An invoice to pay.",
            "emails": [{"ref": "m0", "summary": "Invoice, 120 PLN", "importance": "high"}],
            "tasks": [
                {"email_refs": ["m0"], "title": "Pay the invoice", "planned_in_days": 0, "deadline": None,
                 "duration_min": 10, "priority": "high", "reason": "Due soon"}
            ],
        }
    )
    response = api.post("/mail/digest", json={"today": "2026-10-24"})
    assert response.status_code == 200, response.text
    digest = response.json()["digest"]
    assert digest["summary"] == "An invoice to pay."
    assert {m["subject"]: m["importance"] for m in digest["messages"]} == {"Invoice": "high", "Sale": "normal"}
    [proposal] = digest["proposals"]
    invoice = next(m for m in digest["messages"] if m["subject"] == "Invoice")
    assert proposal["mail_ids"] == [invoice["id"]] and proposal["status"] == "pending"

    stored = supa.rest("GET", "mail_messages", params={"digest_id": f"eq.{digest['id']}", "order": "uid"}).json()
    assert [(m["uid"], m["uidvalidity"], m["category"]) for m in stored] == [(9, 77, "primary"), (12, 77, "promotions")]

    # The same unread mail isn't summarized again (even with commas and parentheses in its Message-ID).
    again = api.post("/mail/digest", json={"today": "2026-10-24"}).json()
    assert again == {"digest": None, "warnings": []}
    assert len(claude.calls) == 1
    assert api.get("/mail/digest/latest").json()["id"] == digest["id"]
