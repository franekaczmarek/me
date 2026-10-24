"""Gmail over IMAP (imap.gmail.com, app passwords): login check, reading unread mail, marking it as read."""

import imaplib
import logging
import ssl
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

import certifi
from fastapi import Depends, HTTPException, status

logger = logging.getLogger(__name__)

HOST = "imap.gmail.com"
TIMEOUT = 20


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


class Gmail:
    """Opens short IMAP sessions to Gmail. Replaced by a fake in tests."""

    def check_login(self, email: str, password: str) -> None:
        with self._session(email, password):
            pass

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


def get_gmail() -> Gmail:
    return Gmail()


GmailDep = Annotated[Gmail, Depends(get_gmail)]
