"""Opt-in live tests: real Claude (RUN_CLAUDE_TESTS=1, costs money) and a real Gmail inbox (RUN_MAIL_TESTS=1 with
MAIL_TEST_EMAIL and MAIL_TEST_APP_PASSWORD; only reads, nothing is marked as read)."""

import json
import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.mail.imap import Gmail, RawMail
from tests.fake_gmail import FakeGmail, raw_mail
from tests.integration.conftest import Supa

LIVE_CLAUDE = pytest.mark.skipif(
    not (os.environ.get("RUN_CLAUDE_TESTS") == "1" and get_settings().anthropic_api_key),
    reason="Live Claude test: set RUN_CLAUDE_TESTS=1 and ANTHROPIC_API_KEY (costs money)",
)
LIVE_GMAIL = pytest.mark.skipif(
    not (os.environ.get("RUN_MAIL_TESTS") == "1" and os.environ.get("MAIL_TEST_EMAIL") and os.environ.get("MAIL_TEST_APP_PASSWORD")),
    reason="Live Gmail test: set RUN_MAIL_TESTS=1, MAIL_TEST_EMAIL and MAIL_TEST_APP_PASSWORD",
)


@LIVE_CLAUDE
def test_live_claude_digests_polish_mail(api: TestClient, supa: Supa, gmail: FakeGmail) -> None:
    today = date.today()
    due = (today + timedelta(days=6)).strftime("%d.%m.%Y")
    assert api.post("/mail/accounts", json={"email": "me@gmail.com", "app_password": "x"}).status_code == 201
    gmail.add(
        "me@gmail.com",
        RawMail(1, "primary", raw_mail("Faktura 10/2026", f"Dzień dobry, w załączniku faktura na 240 zł. Termin płatności: {due}.", sender="Biuro <biuro@firma.pl>")),
        RawMail(2, "promotions", raw_mail("Mega wyprzedaż -50%", "Tylko dziś wszystko taniej!", sender="Sklep <promo@sklep.pl>")),
    )
    response = api.post("/mail/digest", json={"today": today.isoformat()})
    assert response.status_code == 200, response.text
    digest = response.json()["digest"]
    assert digest["summary"]
    importance = {m["subject"]: m["importance"] for m in digest["messages"]}
    assert importance["Mega wyprzedaż -50%"] == "low"
    [pay] = [p for p in digest["proposals"] if "faktur" in p["title"].lower() or "zapłać" in p["title"].lower() or "opłać" in p["title"].lower()]
    assert pay["planned_date"] <= (today + timedelta(days=6)).isoformat()
    assert not any("wyprzeda" in p["title"].lower() for p in digest["proposals"])
    print(json.dumps(digest, ensure_ascii=False, indent=2))


@LIVE_GMAIL
def test_live_gmail_reads_unread_mail_without_marking_it() -> None:
    gmail = Gmail()
    email, password = os.environ["MAIL_TEST_EMAIL"], os.environ["MAIL_TEST_APP_PASSWORD"]
    gmail.check_login(email, password)
    first = gmail.fetch_unread(email, password, limit=5)
    second = gmail.fetch_unread(email, password, limit=5)
    assert first.uidvalidity > 0
    # Reading doesn't mark anything as read, so the same emails are still unread.
    assert [m.uid for m in first.mails] == [m.uid for m in second.mails]
    assert all(m.category in ("primary", "social", "promotions", "updates", "forums") for m in first.mails)
