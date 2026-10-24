"""Raw emails → what Claude reads: sender, subject, date and a short plain text (quotes and signatures cut)."""

import hashlib
import html
import re
from dataclasses import dataclass
from datetime import datetime
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import parsedate_to_datetime

#: Characters of body text kept per email.
MAX_TEXT = 2000

_DROP_BLOCKS = re.compile(r"<(script|style|head)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_BREAKS = re.compile(r"<\s*(br|/p|/div|/tr|/li|/h\d)\b[^>]*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
#: Where an earlier message starts in a reply: "On Mon, … wrote:", "W dniu … napisał(a):", Outlook's marker.
#: (Forwarded messages are kept: what was forwarded is the point.)
_QUOTE_START = re.compile(
    r"^(On .{0,200}wrote:|W dniu .{0,200}napisał\(?a?\)?:|-{2,} ?(Original Message|Wiadomość oryginalna) ?-{2,})$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass
class ParsedMail:
    message_id: str
    sender: str
    subject: str
    received_at: datetime | None
    text: str


def parse_mail(raw: bytes) -> ParsedMail:
    msg = message_from_bytes(raw, policy=policy.default)
    assert isinstance(msg, EmailMessage)
    message_id = _header(msg, "Message-ID")[:998] or f"<sha256-{hashlib.sha256(raw).hexdigest()}>"
    return ParsedMail(
        message_id=message_id,
        sender=_header(msg, "From")[:300],
        subject=" ".join(_header(msg, "Subject").split())[:500],
        received_at=_date(_header(msg, "Date")),
        text=_body(msg),
    )


def _header(msg: EmailMessage, name: str) -> str:
    try:
        return str(msg.get(name, "") or "").strip()
    except (ValueError, LookupError, IndexError):
        # A malformed header: fall back to its raw form.
        raw = msg.get_all(name, failobj=[""])
        return str(raw[0]).strip() if raw else ""


def _date(value: str) -> datetime | None:
    try:
        return parsedate_to_datetime(value) if value else None
    except (TypeError, ValueError, IndexError):
        return None


def _body(msg: EmailMessage) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        content = part.get_content()
    except (LookupError, ValueError, KeyError):
        payload = part.get_payload(decode=True)
        content = payload.decode("utf-8", errors="replace") if isinstance(payload, bytes) else ""
    if not isinstance(content, str):
        return ""
    text = html_to_text(content) if part.get_content_subtype() == "html" else content
    return clean_text(text)


def html_to_text(value: str) -> str:
    value = _DROP_BLOCKS.sub(" ", value)
    value = _BREAKS.sub("\n", value)
    return html.unescape(_TAGS.sub(" ", value))


def clean_text(text: str) -> str:
    """Drops quoted earlier messages and the signature, squeezes whitespace, cuts to MAX_TEXT."""
    text = text.replace("\r\n", "\n").replace("\xa0", " ")
    if (found := _QUOTE_START.search(text)) and text[: found.start()].strip():
        text = text[: found.start()]
    text = text.split("\n-- \n")[0]
    lines = [" ".join(line.split()) for line in text.split("\n") if not line.lstrip().startswith(">")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT].rsplit(" ", 1)[0] + " …"
    return text
