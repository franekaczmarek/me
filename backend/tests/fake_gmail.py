"""Stand-in for Gmail over IMAP, plus a fixed mail encryption key."""

from collections.abc import Iterator

import pytest
from cryptography.fernet import Fernet

from app.core.config import get_settings
from app.mail.imap import MailLoginError, RawMail, Unread, get_gmail
from app.main import app

MAIL_KEY = Fernet.generate_key().decode()


class FakeGmail:
    """Inboxes by address. Records logins and marked emails; `error` (or `errors[email]`) is raised instead."""

    def __init__(self) -> None:
        self.logins: list[tuple[str, str]] = []
        self.passwords: dict[str, str] = {}
        self.error: Exception | None = None
        self.errors: dict[str, Exception] = {}
        self.inboxes: dict[str, Unread] = {}
        self.marked: list[tuple[str, int, list[int]]] = []

    def check_login(self, email: str, password: str) -> None:
        self.logins.append((email, password))
        if error := self.errors.get(email, self.error):
            raise error
        if email in self.passwords and self.passwords[email] != password:
            raise MailLoginError

    def add(self, email: str, *mails: RawMail, uidvalidity: int = 1) -> None:
        self.inboxes[email] = Unread(uidvalidity, list(mails))

    def fetch_unread(self, email: str, password: str, limit: int) -> Unread:
        self.check_login(email, password)
        unread = self.inboxes.get(email, Unread(1, []))
        return Unread(unread.uidvalidity, unread.mails[:limit])

    def mark_read(self, email: str, password: str, uidvalidity: int, uids: list[int]) -> bool:
        self.check_login(email, password)
        if uidvalidity != self.inboxes.get(email, Unread(1, [])).uidvalidity:
            return False
        self.marked.append((email, uidvalidity, uids))
        return True


def raw_mail(subject: str, body: str = "Hello", *, sender: str = "Ann <ann@example.com>", message_id: str | None = None, date: str = "Sat, 24 Oct 2026 09:30:00 +0200") -> bytes:
    """A minimal plain-text email."""
    lines = [
        f"From: {sender}",
        "To: me@gmail.com",
        f"Subject: {subject}",
        f"Date: {date}",
        f"Message-ID: {message_id or '<' + subject.replace(' ', '-') + '@example.com>'}",
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
    ]
    return "\r\n".join(lines).encode()


@pytest.fixture
def mail_key(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(get_settings(), "mail_encryption_key", MAIL_KEY)
    return MAIL_KEY


@pytest.fixture
def gmail(mail_key: str) -> Iterator[FakeGmail]:
    fake = FakeGmail()
    app.dependency_overrides[get_gmail] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_gmail, None)
