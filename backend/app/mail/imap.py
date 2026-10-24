"""Gmail over IMAP (imap.gmail.com, app passwords): login check, reading unread mail, marking it as read."""

import imaplib
import logging
import re
import ssl
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Annotated

import certifi
from fastapi import Depends, HTTPException, status

logger = logging.getLogger(__name__)

HOST = "imap.gmail.com"
TIMEOUT = 20
#: Gmail inbox tabs other than Primary, found with Gmail's own search (X-GM-RAW).
CATEGORIES = ("social", "promotions", "updates", "forums")
#: Bytes fetched per email: its text comes first; attachments beyond this are cut off.
FETCH_BYTES = 300_000


class MailLoginError(Exception):
    """Gmail rejected the address or the app password."""


class MailConnectionError(Exception):
    """Gmail couldn't be reached."""


def http_error(exc: MailLoginError | MailConnectionError) -> HTTPException:
    if isinstance(exc, MailLoginError):
        return HTTPException(
            status.HTTP_400_BAD_REQUEST, "Gmail rejected the login. Check the address and the app password."
        )
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Can't reach Gmail right now.")


@dataclass
class RawMail:
    uid: int
    #: Gmail inbox tab: primary, social, promotions, updates or forums.
    category: str
    raw: bytes


@dataclass
class Unread:
    #: Identifies this version of the inbox's UIDs; marking as read checks it is unchanged.
    uidvalidity: int
    mails: list[RawMail]


class Gmail:
    """Opens short IMAP sessions to Gmail. Replaced by a fake in tests."""

    def check_login(self, email: str, password: str) -> None:
        with self._session(email, password):
            pass

    def fetch_unread(self, email: str, password: str, limit: int) -> Unread:
        """The newest `limit` unread emails of the inbox (every tab), read without marking them as read."""
        with self._session(email, password) as conn:
            uidvalidity = _select(conn, readonly=True)
            uids = _search(conn, "UNSEEN")[-limit:]
            if not uids:
                return Unread(uidvalidity, [])
            category = dict.fromkeys(uids, "primary")
            for name in CATEGORIES:
                for uid in _search(conn, "X-GM-RAW", f'"category:{name}"', "UNSEEN"):
                    if uid in category:
                        category[uid] = name
            _, data = conn.uid("FETCH", ",".join(map(str, uids)), f"(BODY.PEEK[]<0.{FETCH_BYTES}>)")
            mails = []
            for part in data:
                if isinstance(part, tuple) and (found := re.search(rb"UID (\d+)", part[0])):
                    uid = int(found.group(1))
                    mails.append(RawMail(uid, category.get(uid, "primary"), part[1]))
            mails.sort(key=lambda m: m.uid, reverse=True)
            return Unread(uidvalidity, mails)

    def mark_read(self, email: str, password: str, uidvalidity: int, uids: list[int]) -> bool:
        """Marks emails as read; False (and nothing changed) when the inbox's UIDs were renumbered."""
        if not uids:
            return True
        with self._session(email, password) as conn:
            if _select(conn, readonly=False) != uidvalidity:
                return False
            conn.uid("STORE", ",".join(map(str, uids)), "+FLAGS", "(\\Seen)")
            return True

    @contextmanager
    def _session(self, email: str, password: str) -> Iterator[imaplib.IMAP4_SSL]:
        try:
            conn = imaplib.IMAP4_SSL(
                HOST, timeout=TIMEOUT, ssl_context=ssl.create_default_context(cafile=certifi.where())
            )
        except OSError as exc:
            logger.warning("Gmail connection failed: %s", exc)
            raise MailConnectionError from exc
        try:
            try:
                conn.login(email, password)
            except imaplib.IMAP4.error as exc:
                raise MailLoginError from exc
            yield conn
        except (OSError, imaplib.IMAP4.abort) as exc:
            logger.warning("Gmail session failed: %s", exc)
            raise MailConnectionError from exc
        finally:
            try:
                conn.logout()
            except (OSError, imaplib.IMAP4.error):
                pass


def _select(conn: imaplib.IMAP4_SSL, *, readonly: bool) -> int:
    status_, _ = conn.select("INBOX", readonly=readonly)
    if status_ != "OK":
        raise MailConnectionError("INBOX can't be opened")
    _, values = conn.response("UIDVALIDITY")
    return int(values[0])


def _search(conn: imaplib.IMAP4_SSL, *criteria: str) -> list[int]:
    _, data = conn.uid("SEARCH", *criteria)
    return sorted(int(uid) for uid in (data[0] or b"").split())


def get_gmail() -> Gmail:
    return Gmail()


GmailDep = Annotated[Gmail, Depends(get_gmail)]
