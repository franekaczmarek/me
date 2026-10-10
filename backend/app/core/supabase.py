"""Minimal Supabase REST (PostgREST) client that acts as the logged-in user.

Requests carry the user's access token, so Row Level Security applies to every query.
"""

import logging
import ssl
from functools import lru_cache
from typing import Annotated, Any

import certifi
import httpx
from fastapi import Depends, HTTPException, status

from app.core.auth import CurrentUserDep
from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Postgres error codes (as returned by PostgREST) that mean the request itself was invalid.
_INVALID_INPUT_CODES = {
    "23502",  # not_null_violation
    "23514",  # check_violation
    "22007",  # invalid_datetime_format
    "22008",  # datetime_field_overflow
    "22P02",  # invalid_text_representation (e.g. a malformed uuid)
}


@lru_cache
def get_http_client() -> httpx.Client:
    settings = get_settings()
    return httpx.Client(
        base_url=settings.supabase_url,
        headers={"apikey": settings.supabase_anon_key},
        # certifi's CA bundle: the system one is missing on some setups.
        verify=ssl.create_default_context(cafile=certifi.where()),
        timeout=15,
    )


class Supabase:
    def __init__(self, http: httpx.Client, token: str) -> None:
        self._http = http
        self._token = token

    def rest(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
    ) -> list[dict[str, Any]]:
        """Call /rest/v1/{table}; returns the affected/selected rows."""
        try:
            response = self._http.request(
                method,
                f"/rest/v1/{table}",
                params=params,
                json=json,
                headers={"Authorization": f"Bearer {self._token}", "Prefer": "return=representation"},
            )
        except httpx.HTTPError as exc:
            logger.error("Supabase request failed: %s", exc)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database unavailable") from exc
        if response.is_success:
            return response.json() if response.content else []
        raise _to_http_error(response)


def _to_http_error(response: httpx.Response) -> HTTPException:
    try:
        body = response.json()
    except ValueError:
        body = {}
    code = body.get("code") if isinstance(body, dict) else None
    if code == "23505":
        return HTTPException(status.HTTP_409_CONFLICT, "Already exists")
    if code == "23503":
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Referenced item not found")
    if code in _INVALID_INPUT_CODES:
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, body.get("message") or "Invalid data")
    if response.status_code == 401:
        return HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    logger.error("Unexpected Supabase error %s: %s", response.status_code, response.text)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Database error")


def get_supabase(
    user: CurrentUserDep,
    http: Annotated[httpx.Client, Depends(get_http_client)],
) -> Supabase:
    return Supabase(http, user.token)


# Use as a route parameter type: `db: SupabaseDep`.
SupabaseDep = Annotated[Supabase, Depends(get_supabase)]
