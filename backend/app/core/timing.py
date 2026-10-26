"""Server-Timing header: how long a request took and how much of it was spent waiting for Supabase."""

import threading
import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass

from fastapi import Request, Response


@dataclass
class DbTiming:
    queries: int = 0
    seconds: float = 0.0


# Set per request by the middleware. Sync routes run in a worker thread with a copy of the
# context, so they share this same (mutable) object.
_current: ContextVar[DbTiming | None] = ContextVar("db_timing", default=None)


_lock = threading.Lock()


def record_db(seconds: float) -> None:
    timing = _current.get()
    if timing is not None:
        with _lock:  # calls made in parallel record from several threads
            timing.queries += 1
            timing.seconds += seconds


def server_timing(db: DbTiming, total: float) -> str:
    return f'db;dur={db.seconds * 1000:.1f};desc="{db.queries} queries", total;dur={total * 1000:.1f}'


async def timing_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    db = DbTiming()
    token = _current.set(db)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    finally:
        _current.reset(token)
    response.headers["Server-Timing"] = server_timing(db, time.perf_counter() - started)
    # Lets the browser's dev tools show the timings for the cross-origin frontend.
    response.headers["Timing-Allow-Origin"] = "*"
    return response
