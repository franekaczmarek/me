"""Minimal Supabase REST (PostgREST) and Storage client that acts as the logged-in user.

Requests carry the user's access token, so Row Level Security and storage policies apply to every call.
"""

import contextvars
import logging
import ssl
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Annotated, Any

import certifi
import httpx
from fastapi import Depends, HTTPException, status

from app.core.auth import CurrentUserDep
from app.core.config import get_settings
from app.core.timing import record_db

logger = logging.getLogger(__name__)

# Postgres error codes (as returned by PostgREST) that mean the request itself was invalid.
_INVALID_INPUT_CODES = {
    "23502",  # not_null_violation
    "23514",  # check_violation
    "22007",  # invalid_datetime_format
    "22008",  # datetime_field_overflow
    "22P02",  # invalid_text_representation (e.g. a malformed uuid)
}


CONNECT_RETRIES = 3

# Each Supabase call is a round trip to the cloud, so independent ones run at the same time.
_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="supabase")
# Off in unit tests: the fake database answers in the order the calls are made.
PARALLEL = True


def parallel(*calls: Callable[[], Any]) -> list[Any]:
    """Run independent calls at once; results come in call order, the first error is raised."""
    if not PARALLEL or len(calls) < 2:
        return [call() for call in calls]
    # Copying the context keeps the request's Server-Timing count.
    futures = [_pool.submit(contextvars.copy_context().run, call) for call in calls]
    return [future.result() for future in futures]


@lru_cache
def get_http_client() -> httpx.Client:
    settings = get_settings()
    return httpx.Client(
        base_url=settings.supabase_url,
        headers={"apikey": settings.supabase_anon_key},
        # Retries only failed connection attempts (e.g. a DNS hiccup), so it never
        # repeats a request that reached the server. certifi's CA bundle: the
        # system one is missing on some setups.
        transport=httpx.HTTPTransport(
            retries=CONNECT_RETRIES,
            verify=ssl.create_default_context(cafile=certifi.where()),
        ),
        timeout=15,
    )


class Supabase:
    def __init__(self, http: httpx.Client, token: str, user_id: str) -> None:
        self._http = http
        self._token = token
        self.user_id = user_id

    def rest(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        """Call /rest/v1/{table}; returns the affected/selected rows."""
        response = self._send(method, f"/rest/v1/{table}", params=params, json=json, headers={"Prefer": prefer})
        return response.json() if response.content else []

    # --- storage (bucket policies restrict users to their own folder) -----------

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self._send(
            "POST",
            f"/storage/v1/object/{bucket}/{path}",
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "false"},
        )

    def remove(self, bucket: str, paths: list[str]) -> None:
        if paths:
            self._send("DELETE", f"/storage/v1/object/{bucket}", json={"prefixes": paths})

    def signed_urls(self, bucket: str, paths: list[str], expires_in: int) -> dict[str, str]:
        """Map each path to a temporary download URL."""
        if not paths:
            return {}
        response = self._send(
            "POST", f"/storage/v1/object/sign/{bucket}", json={"expiresIn": expires_in, "paths": paths}
        )
        base = f"{self._http.base_url}".rstrip("/") + "/storage/v1"
        return {item["path"]: base + item["signedURL"] for item in response.json() if item.get("signedURL")}

    def _send(
        self, method: str, url: str, *, headers: dict[str, str] | None = None, **kwargs: Any
    ) -> httpx.Response:
        started = time.perf_counter()
        try:
            response = self._http.request(
                method, url, headers={"Authorization": f"Bearer {self._token}", **(headers or {})}, **kwargs
            )
        except httpx.HTTPError as exc:
            logger.error("Supabase request failed: %s", exc)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database unavailable") from exc
        finally:
            record_db(time.perf_counter() - started)
        if response.is_success:
            return response
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


def one_or_404(rows: list[dict[str, Any]], what: str) -> dict[str, Any]:
    # RLS hides other users' rows, so "not yours" and "doesn't exist" look the same.
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return rows[0]


def get_supabase(
    user: CurrentUserDep,
    http: Annotated[httpx.Client, Depends(get_http_client)],
) -> Supabase:
    return Supabase(http, user.token, user.id)


# Use as a route parameter type: `db: SupabaseDep`.
SupabaseDep = Annotated[Supabase, Depends(get_supabase)]
