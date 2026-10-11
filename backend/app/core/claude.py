"""Shared Claude API access: the client, one structured-output call, and error → HTTP mapping."""

import logging
from functools import lru_cache
from typing import Annotated, Any

import anthropic
from fastapi import Depends, HTTPException, status
from pydantic import BaseModel, ValidationError

from app.core.auth import CurrentUserDep
from app.core.config import get_settings

logger = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
# Server-side fallback: if a safety classifier declines, the API retries on Anthropic's recommended model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


@lru_cache
def _client(api_key: str, workspace_id: str) -> anthropic.Anthropic:
    headers = {"anthropic-workspace-id": workspace_id} if workspace_id else None
    return anthropic.Anthropic(api_key=api_key, timeout=180, max_retries=2, default_headers=headers)


def get_claude(user: CurrentUserDep) -> anthropic.Anthropic:
    """The Claude client, for logged-in users only (calls cost money); 503 without an API key.

    Overridden in tests.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Claude isn't set up (no API key).")
    return _client(settings.anthropic_api_key, settings.anthropic_workspace_id)


ClaudeDep = Annotated[anthropic.Anthropic, Depends(get_claude)]


def ask_structured[T: BaseModel](
    client: anthropic.Anthropic,
    *,
    system: str,
    content: str,
    schema: dict[str, Any],
    model: type[T],
    effort: str,
    what: str,
    max_tokens: int = 16000,
) -> T:
    """One Claude call whose answer must match `schema`; returns it parsed into `model`.

    `what` names the result in error messages ("a plan", "your tasks").
    """
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            system=system,
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.AuthenticationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The Claude API key was rejected.") from exc
    except anthropic.RateLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Claude is busy right now; try again in a minute.") from exc
    except anthropic.APIStatusError as exc:
        logger.error("Claude API error %s (request %s): %s", exc.status_code, exc.request_id, exc.message)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Claude couldn't make {what} right now.") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Can't reach Claude right now.") from exc

    if response.stop_reason == "refusal":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Claude declined to make {what}.")
    if response.stop_reason == "max_tokens":
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Claude's answer was cut off; try with less at once.")
    text = "".join(block.text for block in response.content if block.type == "text")
    try:
        return model.model_validate_json(text)
    except ValidationError as exc:
        logger.error("Unexpected Claude output (request %s): %s", response._request_id, exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Claude's answer couldn't be read.") from exc
