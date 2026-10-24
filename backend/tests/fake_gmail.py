"""Stand-in for Gmail over IMAP, plus a fixed mail encryption key."""

from collections.abc import Iterator

import pytest
from cryptography.fernet import Fernet

from app.core.config import get_settings
from app.mail.imap import MailLoginError, get_gmail
from app.main import app

MAIL_KEY = Fernet.generate_key().decode()


class FakeGmail:
    """Records logins; `error` is raised by every call instead."""

    def __init__(self) -> None:
        self.logins: list[tuple[str, str]] = []
        self.passwords: dict[str, str] = {}
        self.error: Exception | None = None

    def check_login(self, email: str, password: str) -> None:
        self.logins.append((email, password))
        if self.error:
            raise self.error
        if email in self.passwords and self.passwords[email] != password:
            raise MailLoginError


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
