"""Encryption of the stored Gmail app passwords (Fernet, key in MAIL_ENCRYPTION_KEY; never in the database)."""

from typing import Annotated

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status

from app.core.config import get_settings


class Cipher:
    def __init__(self, key: str) -> None:
        self._fernet = Fernet(key)

    def encrypt(self, secret: str) -> str:
        return self._fernet.encrypt(secret.encode()).decode()

    def decrypt(self, token: str) -> str | None:
        """None when the token was made with another key (the password has to be entered again)."""
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken:
            return None


def get_cipher() -> Cipher:
    """503 when the key is missing or malformed: the Mail module is not set up."""
    key = get_settings().mail_encryption_key
    if not key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Mail isn't set up (no MAIL_ENCRYPTION_KEY).")
    try:
        return Cipher(key)
    except ValueError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Mail isn't set up (MAIL_ENCRYPTION_KEY is invalid).") from exc


CipherDep = Annotated[Cipher, Depends(get_cipher)]
