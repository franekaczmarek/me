import imaplib

import pytest

from app.mail import imap
from app.mail.imap import Gmail, MailConnectionError, MailLoginError


class FakeConn:
    """Stands in for imaplib.IMAP4_SSL: a Gmail inbox with UIDs, unread ones and tabs."""

    def __init__(self, unread: list[int], tabs: dict[str, list[int]], uidvalidity: int = 7) -> None:
        self.unread = unread
        self.tabs = tabs
        self.uidvalidity = uidvalidity
        self.commands: list[tuple] = []
        self.password = "secret"
        self.logged_out = False

    def login(self, user: str, password: str):
        if password != self.password:
            raise imaplib.IMAP4.error("AUTHENTICATIONFAILED")
        return "OK", [b"ok"]

    def select(self, mailbox: str, readonly: bool = False):
        self.commands.append(("SELECT", mailbox, readonly))
        return "OK", [b"3"]

    def response(self, code: str):
        return code, [str(self.uidvalidity).encode()]

    def uid(self, command: str, *args: str):
        self.commands.append((command, *args))
        if command == "SEARCH":
            if args[0] == "UNSEEN":
                uids = self.unread
            else:
                tab = args[1].strip('"').split(":")[1]
                uids = [u for u in self.tabs.get(tab, []) if u in self.unread]
            return "OK", [" ".join(map(str, uids)).encode()]
        if command == "FETCH":
            data: list = []
            for uid in args[0].split(","):
                data += [(f"1 (UID {uid} BODY[]<0> {{5}}".encode(), f"mail{uid}".encode()), b")"]
            return "OK", data
        return "OK", [b""]

    def logout(self):
        self.logged_out = True


@pytest.fixture
def conn(monkeypatch: pytest.MonkeyPatch) -> FakeConn:
    fake = FakeConn(unread=[3, 5, 9, 12], tabs={"promotions": [5, 6], "updates": [12]})
    monkeypatch.setattr(imap.imaplib, "IMAP4_SSL", lambda *args, **kwargs: fake)
    return fake


def test_fetch_unread_reads_without_marking(conn: FakeConn) -> None:
    unread = Gmail().fetch_unread("me@gmail.com", "secret", limit=3)
    assert unread.uidvalidity == 7
    assert [(m.uid, m.category, m.raw) for m in unread.mails] == [
        (12, "updates", b"mail12"),
        (9, "primary", b"mail9"),
        (5, "promotions", b"mail5"),
    ]
    assert ("SELECT", "INBOX", True) in conn.commands
    fetch = next(c for c in conn.commands if c[0] == "FETCH")
    assert fetch[1] == "5,9,12" and "PEEK" in fetch[2]
    assert not any(c[0] == "STORE" for c in conn.commands)
    assert conn.logged_out


def test_fetch_with_nothing_unread(conn: FakeConn) -> None:
    conn.unread = []
    assert Gmail().fetch_unread("me@gmail.com", "secret", limit=40).mails == []
    assert not any(c[0] == "FETCH" for c in conn.commands)


def test_mark_read_checks_uidvalidity(conn: FakeConn) -> None:
    assert Gmail().mark_read("me@gmail.com", "secret", 7, [5, 9]) is True
    assert ("SELECT", "INBOX", False) in conn.commands
    assert ("STORE", "5,9", "+FLAGS", "(\\Seen)") in conn.commands
    conn.commands.clear()
    assert Gmail().mark_read("me@gmail.com", "secret", 8, [5]) is False
    assert not any(c[0] == "STORE" for c in conn.commands)
    assert Gmail().mark_read("me@gmail.com", "secret", 7, []) is True


def test_login_and_connection_errors(conn: FakeConn, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(MailLoginError):
        Gmail().check_login("me@gmail.com", "wrong")
    assert conn.logged_out

    def unreachable(*args, **kwargs):
        raise OSError("nodename nor servname provided")

    monkeypatch.setattr(imap.imaplib, "IMAP4_SSL", unreachable)
    with pytest.raises(MailConnectionError):
        Gmail().check_login("me@gmail.com", "secret")


def test_dropped_connection(conn: FakeConn) -> None:
    def drop(*args):
        raise imaplib.IMAP4.abort("socket error")

    conn.uid = drop  # type: ignore[method-assign]
    with pytest.raises(MailConnectionError):
        Gmail().fetch_unread("me@gmail.com", "secret", limit=40)
