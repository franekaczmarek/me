import logging
import ssl
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated

import certifi
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

# Supabase signs access tokens with asymmetric keys published as JWKS.
ALLOWED_ALGORITHMS = ["ES256", "RS256"]
AUDIENCE = "authenticated"

bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    # Raw access token, forwarded to Supabase so RLS applies.
    token: str


@lru_cache
def get_jwks_client() -> jwt.PyJWKClient:
    settings = get_settings()
    # certifi's CA bundle: the system one is missing on some setups (e.g. python.org macOS builds).
    return jwt.PyJWKClient(
        f"{settings.supabase_url}/auth/v1/.well-known/jwks.json",
        ssl_context=ssl.create_default_context(cafile=certifi.where()),
    )


def get_signing_key(token: str):
    """Return the public key that signed the token. Overridden in tests."""
    return get_jwks_client().get_signing_key_from_jwt(token).key


def decode_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(
        token,
        get_signing_key(token),
        algorithms=ALLOWED_ALGORITHMS,
        audience=AUDIENCE,
        issuer=f"{settings.supabase_url}/auth/v1",
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        claims = decode_token(credentials.credentials)
    except jwt.PyJWKClientConnectionError as exc:
        # Can't fetch Supabase's public keys: a server problem, not a bad token.
        logger.error("Cannot fetch Supabase JWKS: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Auth keys unavailable") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    return CurrentUser(id=claims["sub"], email=claims.get("email"), token=credentials.credentials)


# Use as a route parameter type: `user: CurrentUserDep`.
CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
