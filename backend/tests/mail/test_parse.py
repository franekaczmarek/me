from datetime import UTC, datetime
from email.message import EmailMessage

from app.mail.parse import MAX_TEXT, clean_text, html_to_text, parse_mail
from tests.fake_gmail import raw_mail


def test_plain_email() -> None:
    mail = parse_mail(raw_mail("Invoice 10/2026", "Please pay 120 PLN by Friday."))
    assert mail.subject == "Invoice 10/2026"
    assert mail.sender == "Ann <ann@example.com>"
    assert mail.message_id == "<Invoice-10/2026@example.com>"
    assert mail.received_at == datetime(2026, 10, 24, 7, 30, tzinfo=UTC)
    assert mail.text == "Please pay 120 PLN by Friday."


def test_encoded_headers_and_utf8_body() -> None:
    msg = EmailMessage()
    msg["From"] = "Łukasz Żółw <lz@example.pl>"
    msg["Subject"] = "Spotkanie w środę – potwierdź"
    msg["Message-ID"] = "<x@y>"
    msg.set_content("Cześć, czy środa 15:00 pasuje?")
    raw = msg.as_bytes()
    assert b"=?utf-8?" in raw
    mail = parse_mail(raw)
    assert mail.sender == "Łukasz Żółw <lz@example.pl>"
    assert mail.subject == "Spotkanie w środę – potwierdź"
    assert mail.text == "Cześć, czy środa 15:00 pasuje?"


def test_prefers_plain_text_over_html() -> None:
    msg = EmailMessage()
    msg["Subject"] = "Both"
    msg.set_content("Plain version")
    msg.add_alternative("<p>HTML version</p>", subtype="html")
    assert parse_mail(msg.as_bytes()).text == "Plain version"


def test_html_only_becomes_text() -> None:
    msg = EmailMessage()
    msg["Subject"] = "News"
    msg.set_content(
        "<html><head><style>p{color:red}</style></head><body><p>Hello&nbsp;there</p>"
        "<script>alert(1)</script><div>Sale &amp; more</div></body></html>",
        subtype="html",
    )
    assert parse_mail(msg.as_bytes()).text == "Hello there\nSale & more"


def test_attachments_are_ignored() -> None:
    msg = EmailMessage()
    msg["Subject"] = "Scan"
    msg.set_content("See the attached scan.")
    msg.add_attachment(b"%PDF-1.4 binary", maintype="application", subtype="pdf", filename="scan.pdf")
    assert parse_mail(msg.as_bytes()).text == "See the attached scan."


def test_missing_headers() -> None:
    raw = b"Content-Type: text/plain\r\n\r\nNo headers at all"
    mail = parse_mail(raw)
    assert mail.message_id.startswith("<sha256-")
    assert parse_mail(raw).message_id == mail.message_id
    assert (mail.sender, mail.subject, mail.received_at, mail.text) == ("", "", None, "No headers at all")
    assert parse_mail(raw_mail("x", date="not a date")).received_at is None


def test_bad_charset_falls_back() -> None:
    raw = b"Subject: x\r\nContent-Type: text/plain; charset=nonsense\r\n\r\nHello \xff"
    assert parse_mail(raw).text.startswith("Hello")


def test_quoted_replies_and_signatures_are_cut() -> None:
    reply = "Yes, Friday works.\n\nOn Fri, 23 Oct 2026 at 10:00, Ann <ann@example.com> wrote:\n> Does Friday work?"
    assert clean_text(reply) == "Yes, Friday works."
    polish = "Pasuje.\nW dniu 23.10.2026 o 10:00 Anna napisała:\n> Czy pasuje?"
    assert clean_text(polish) == "Pasuje."
    assert clean_text("Thanks!\n-- \nAnn\nCEO") == "Thanks!"
    assert clean_text("Top\n> quoted line\nBottom") == "Top\nBottom"


def test_forwarded_mail_is_kept() -> None:
    text = "FYI\n---------- Forwarded message ---------\nFrom: Bank <b@bank.pl>\nYour card expires."
    assert "Your card expires." in clean_text(text)
    # A quote marker at the very top leaves the rest in place.
    assert clean_text("On Fri Ann wrote:\nthe whole text") == "On Fri Ann wrote:\nthe whole text"


def test_whitespace_and_length() -> None:
    assert clean_text("a   b\r\n\r\n\r\n\r\nc\xa0d") == "a b\n\nc d"
    long = clean_text("word " * 1000)
    assert len(long) <= MAX_TEXT + 2 and long.endswith(" …")


def test_html_to_text_keeps_line_breaks() -> None:
    assert html_to_text("a<br>b<BR/>c</p>d").split() == ["a", "b", "c", "d"]
