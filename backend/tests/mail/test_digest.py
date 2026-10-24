import json
from datetime import date

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.mail.crypto import Cipher
from app.mail.digest import MAX_TASKS, ClaudeDigest, ClaudeEmail, ClaudeTask, NewMail, build_context, check_digest
from app.mail.imap import MailConnectionError, MailLoginError, RawMail
from app.mail.parse import parse_mail
from tests.conftest import make_token
from tests.fake_claude import FakeClaude
from tests.fake_gmail import MAIL_KEY, FakeGmail, raw_mail
from tests.fake_supabase import FakeSupabase

TODAY = date(2026, 10, 24)
USER_ID = "11111111-1111-1111-1111-111111111111"
PRIVATE_ID = "a0000000-0000-0000-0000-000000000001"
WORK_ID = "a0000000-0000-0000-0000-000000000002"
DIGEST_ID = "d0000000-0000-0000-0000-000000000001"
DIGEST_ROW = {"id": DIGEST_ID, "summary": "", "proposals": [], "created_at": "2026-10-24T10:00:00Z", "applied_at": None}


def task(refs: list[str], title: str = "Pay the invoice", days: int = 0, **fields) -> ClaudeTask:
    return ClaudeTask(email_refs=refs, title=title, planned_in_days=days, **fields)


def digest(*tasks: ClaudeTask, emails: list[ClaudeEmail] | None = None) -> ClaudeDigest:
    return ClaudeDigest(summary="  One invoice. ", emails=emails or [], tasks=list(tasks))


# --- pure checks -----------------------------------------------------------------------


def test_check_keeps_tasks_from_known_emails() -> None:
    summary, notes, tasks, dates, warnings = check_digest(
        digest(
            task(["m0", "m9", "m0"], "  Pay   the invoice ", 2, deadline="2026-10-30", duration_min=10, priority="high"),
            task(["m9"], "From nowhere"),
            task(["m1"], "   "),
            emails=[ClaudeEmail(ref="m0", summary="Invoice", importance="high"), ClaudeEmail(ref="zz", summary="?")],
        ),
        ["m0", "m1"],
        TODAY,
    )
    assert summary == "One invoice."
    assert list(notes) == ["m0"]
    assert [(t.title, t.email_refs, t.duration_min, t.priority) for t in tasks] == [("Pay the invoice", ["m0"], 10, "high")]
    assert dates == [(date(2026, 10, 26), date(2026, 10, 30))]
    assert len(warnings) == 2


def test_check_fixes_dates() -> None:
    _, _, _, dates, _ = check_digest(
        digest(
            task(["m0"], "Past deadline", -3, deadline="2026-10-01"),
            task(["m0"], "Planned after the deadline", 10, deadline="2026-10-27"),
            task(["m0"], "Far away", 5000, deadline="2030-01-01"),
            task(["m0"], "Not a date", 1, deadline="next Friday"),
        ),
        ["m0"],
        TODAY,
    )
    assert dates == [
        (TODAY, None),
        (date(2026, 10, 27), date(2026, 10, 27)),
        (date(2027, 10, 24), None),
        (date(2026, 10, 25), None),
    ]


def test_check_drops_repeats_bad_durations_and_extra_tasks() -> None:
    many = [task(["m0"], f"Task {i}") for i in range(MAX_TASKS + 3)]
    _, _, tasks, _, warnings = check_digest(
        digest(task(["m0"], "Reply to Ann", duration_min=0), task(["m0"], "reply to ann!"), *many), ["m0"], TODAY
    )
    assert len(tasks) == MAX_TASKS
    assert tasks[0].duration_min is None
    assert sum(t.title.lower().startswith("reply") for t in tasks) == 1
    assert warnings == [f"Only the first {MAX_TASKS} tasks were kept."]


def test_context_lists_the_emails() -> None:
    mail = NewMail("m0", PRIVATE_ID, "Private", 1, 5, "updates", parse_mail(raw_mail("Parcel", "Arrives today")))
    context = build_context([mail], TODAY)
    assert context["today"] == "2026-10-24" and context["weekday"] == "Saturday"
    assert context["emails"] == [
        {
            "ref": "m0",
            "inbox": "Private",
            "tab": "updates",
            "from": "Ann <ann@example.com>",
            "subject": "Parcel",
            "date": "2026-10-24T09:30+02:00",
            "text": "Arrives today",
        }
    ]


# --- endpoints -------------------------------------------------------------------------


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token(user_id=USER_ID)}"
    return client


def account(id_: str, email: str, label: str = "", password: str = "secret") -> dict:
    return {"id": id_, "email": email, "label": label, "password_enc": Cipher(MAIL_KEY).encrypt(password)}


def saved(request: httpx.Request) -> httpx.Response:
    """Rows the database returns for inserted messages: their new ids."""
    rows = json.loads(request.content)
    return httpx.Response(
        201,
        json=[
            {"id": f"f0000000-0000-0000-0000-00000000000{i}", "message_id": m["message_id"], "account_id": m["account_id"]}
            for i, m in enumerate(rows)
        ],
    )


def test_no_inboxes_means_no_claude_call(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail, claude: FakeClaude) -> None:
    fake_db.reply(200, [])
    assert api.post("/mail/digest", json={"today": "2026-10-24"}).json() == {"digest": None, "warnings": []}
    assert claude.calls == []


def test_mail_summarized_before_is_skipped(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail, claude: FakeClaude) -> None:
    gmail.add("me@gmail.com", RawMail(5, "primary", raw_mail("Old one")))
    fake_db.reply(200, [account(PRIVATE_ID, "me@gmail.com")])
    fake_db.reply(200, [{"message_id": "<Old-one@example.com>"}])
    assert api.post("/mail/digest", json={"today": "2026-10-24"}).json()["digest"] is None
    assert claude.calls == []
    assert fake_db.last.url.params["message_id"] == 'in.("<Old-one@example.com>")'


def test_digest_reads_every_inbox_and_saves_the_result(
    api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail, claude: FakeClaude
) -> None:
    gmail.add(
        "me@gmail.com",
        RawMail(12, "promotions", raw_mail("Sale", "50% off", date="Sat, 24 Oct 2026 08:00:00 +0000")),
        RawMail(9, "primary", raw_mail("Invoice", "Pay 120 PLN by 30.10", date="Sat, 24 Oct 2026 09:00:00 +0000")),
        uidvalidity=77,
    )
    gmail.errors["work@firm.pl"] = MailLoginError()
    fake_db.reply(200, [account(PRIVATE_ID, "me@gmail.com", "Private"), account(WORK_ID, "work@firm.pl", "Work")])
    fake_db.reply(200, [])  # nothing summarized before
    claude.reply(
        {
            "summary": "An invoice to pay and a sale.",
            "emails": [
                {"ref": "m0", "summary": "Invoice for 120 PLN, due 30 Oct", "importance": "high"},
                {"ref": "m1", "summary": "Half-price sale", "importance": "low"},
            ],
            "tasks": [
                {"email_refs": ["m0"], "title": "Pay the invoice", "planned_in_days": 1, "deadline": "2026-10-30",
                 "duration_min": 10, "priority": "normal", "reason": "Due on Friday"}
            ],
        }
    )
    fake_db.reply(201, [DIGEST_ROW])
    fake_db.reply_with(saved)
    fake_db.reply(200, [{**DIGEST_ROW, "summary": "An invoice to pay and a sale."}])
    fake_db.reply(200, [])

    response = api.post("/mail/digest", json={"today": "2026-10-24"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["warnings"] == ["Gmail rejected the login for Work. Set a new app password."]

    request = claude.calls[0]
    assert request["output_config"]["effort"] == "low"
    context = json.loads(request["messages"][0]["content"])
    assert [(e["ref"], e["subject"], e["tab"], e["inbox"]) for e in context["emails"]] == [
        ("m0", "Invoice", "primary", "Private"),
        ("m1", "Sale", "promotions", "Private"),
    ]

    posts = [r for r in fake_db.requests if r.method == "POST"]
    assert json.loads(posts[0].content) == {"summary": "An invoice to pay and a sale."}
    messages = json.loads(posts[1].content)
    assert [(m["uid"], m["uidvalidity"], m["category"], m["importance"], m["summary"]) for m in messages] == [
        (9, 77, "primary", "high", "Invoice for 120 PLN, due 30 Oct"),
        (12, 77, "promotions", "low", "Half-price sale"),
    ]
    assert all(m["digest_id"] == DIGEST_ID and m["account_id"] == PRIVATE_ID for m in messages)

    patch = next(r for r in fake_db.requests if r.method == "PATCH")
    [proposal] = json.loads(patch.content)["proposals"]
    assert proposal | {"id": None} == {
        "id": None,
        "title": "Pay the invoice",
        "planned_date": "2026-10-25",
        "deadline": "2026-10-30",
        "duration_min": 10,
        "priority": "normal",
        "reason": "Due on Friday",
        "mail_ids": ["f0000000-0000-0000-0000-000000000000"],
        "status": "pending",
    }
    assert body["digest"]["id"] == DIGEST_ID


def test_unreadable_passwords_and_unreachable_gmail_are_warnings(
    api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail, claude: FakeClaude
) -> None:
    gmail.errors["work@firm.pl"] = MailConnectionError()
    other_key = Cipher(Fernet.generate_key().decode()).encrypt("x")
    fake_db.reply(200, [account(PRIVATE_ID, "me@gmail.com", "Private") | {"password_enc": other_key}, account(WORK_ID, "work@firm.pl")])
    assert api.post("/mail/digest", json={}).json() == {
        "digest": None,
        "warnings": [
            "Set a new app password for Private: the saved one can't be read anymore.",
            "Couldn't reach Gmail for work@firm.pl.",
        ],
    }
    assert claude.calls == []


def test_latest_digest(api: TestClient, fake_db: FakeSupabase) -> None:
    assert api.get("/mail/digest/latest").json() is None
    message = {
        "id": "f0000000-0000-0000-0000-000000000000",
        "account_id": PRIVATE_ID,
        "sender": "Ann",
        "subject": "Invoice",
        "received_at": None,
        "category": "primary",
        "summary": "Pay it",
        "importance": "high",
        "marked_read": False,
    }
    fake_db.reply(200, [DIGEST_ROW])
    fake_db.reply(200, [message])
    body = api.get("/mail/digest/latest").json()
    assert body["messages"] == [message] and body["id"] == DIGEST_ID
    assert fake_db.last.url.params["digest_id"] == f"eq.{DIGEST_ID}"


def test_digest_needs_claude(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    assert api.post("/mail/digest", json={}).status_code == 503
