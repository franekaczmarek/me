import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.mail.crypto import Cipher
from app.mail.imap import MailConnectionError
from tests.conftest import make_token
from tests.fake_gmail import MAIL_KEY, FakeGmail
from tests.fake_supabase import FakeSupabase

USER_ID = "11111111-1111-1111-1111-111111111111"
ACCOUNT_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT = {
    "id": ACCOUNT_ID,
    "email": "me@gmail.com",
    "label": "Private",
    "color": "#56a8f5",
    "created_at": "2026-10-24T10:00:00Z",
}


@pytest.fixture
def api(client: TestClient) -> TestClient:
    client.headers["Authorization"] = f"Bearer {make_token(user_id=USER_ID)}"
    return client


def test_cipher_round_trip_and_other_keys() -> None:
    cipher = Cipher(MAIL_KEY)
    token = cipher.encrypt("abcdefghijklmnop")
    assert "abcdefghijklmnop" not in token
    assert cipher.decrypt(token) == "abcdefghijklmnop"
    assert Cipher(Fernet.generate_key().decode()).decrypt(token) is None


def test_requires_a_token(client: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    assert client.get("/mail/accounts").status_code == 401


def test_lists_accounts_without_passwords(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    fake_db.reply(200, [ACCOUNT])
    assert api.get("/mail/accounts").json() == [ACCOUNT]
    assert "password" not in fake_db.last.url.params["select"]


def test_create_checks_the_login_and_stores_the_password_encrypted(
    api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail
) -> None:
    fake_db.reply(200, [])
    fake_db.reply(201, [ACCOUNT])
    body = {"email": " Me@Gmail.com ", "app_password": "abcd efgh ijkl mnop", "label": "Private"}
    response = api.post("/mail/accounts", json=body)
    assert response.status_code == 201
    assert response.json() == ACCOUNT
    assert gmail.logins == [("me@gmail.com", "abcdefghijklmnop")]
    row = fake_db.last_json
    assert row["email"] == "me@gmail.com"
    assert "abcdefghijklmnop" not in row["password_enc"]
    assert Cipher(MAIL_KEY).decrypt(row["password_enc"]) == "abcdefghijklmnop"


def test_create_rejects_a_wrong_password_and_saves_nothing(
    api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail
) -> None:
    gmail.passwords["me@gmail.com"] = "right"
    response = api.post("/mail/accounts", json={"email": "me@gmail.com", "app_password": "wrong"})
    assert response.status_code == 400
    assert "app password" in response.json()["detail"]
    assert [r.method for r in fake_db.requests] == ["GET"]


def test_create_when_gmail_is_unreachable(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    gmail.error = MailConnectionError()
    response = api.post("/mail/accounts", json={"email": "me@gmail.com", "app_password": "x"})
    assert response.status_code == 503


def test_create_rejects_duplicates_and_too_many_without_logging_in(
    api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail
) -> None:
    fake_db.reply(200, [{"email": "me@gmail.com"}])
    assert api.post("/mail/accounts", json={"email": "ME@gmail.com", "app_password": "x"}).status_code == 409
    fake_db.reply(200, [{"email": f"a{i}@gmail.com"} for i in range(5)])
    assert api.post("/mail/accounts", json={"email": "new@gmail.com", "app_password": "x"}).status_code == 422
    assert gmail.logins == []


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-email", "app_password": "x"},
        {"email": "me@gmail.com", "app_password": "   "},
        {"email": "me@gmail.com", "app_password": "x", "color": "red"},
        {"email": "me@gmail.com", "app_password": "x", "label": "x" * 61},
    ],
)
def test_create_validates_input(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail, body: dict) -> None:
    assert api.post("/mail/accounts", json=body).status_code == 422
    assert gmail.logins == []


def test_mail_needs_an_encryption_key(
    api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "mail_encryption_key", "")
    response = api.post("/mail/accounts", json={"email": "me@gmail.com", "app_password": "x"})
    assert response.status_code == 503
    monkeypatch.setattr(get_settings(), "mail_encryption_key", "not-a-key")
    assert api.post("/mail/accounts", json={"email": "me@gmail.com", "app_password": "x"}).status_code == 503


def test_update_label_and_colour_without_logging_in(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    fake_db.reply(200, [ACCOUNT])
    fake_db.reply(200, [{**ACCOUNT, "label": "Work", "color": "#ff7a6b"}])
    response = api.patch(f"/mail/accounts/{ACCOUNT_ID}", json={"label": "Work", "color": "#FF7A6B"})
    assert response.json()["label"] == "Work"
    assert fake_db.last_json == {"label": "Work", "color": "#ff7a6b"}
    assert gmail.logins == []


def test_update_password_checks_it_first(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    gmail.passwords["me@gmail.com"] = "newpassword"
    fake_db.reply(200, [ACCOUNT])
    assert api.patch(f"/mail/accounts/{ACCOUNT_ID}", json={"app_password": "wrong"}).status_code == 400
    fake_db.reply(200, [ACCOUNT])
    fake_db.reply(200, [ACCOUNT])
    assert api.patch(f"/mail/accounts/{ACCOUNT_ID}", json={"app_password": "new password"}).status_code == 200
    assert Cipher(MAIL_KEY).decrypt(fake_db.last_json["password_enc"]) == "newpassword"


def test_update_with_nothing_to_change(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    fake_db.reply(200, [ACCOUNT])
    assert api.patch(f"/mail/accounts/{ACCOUNT_ID}", json={}).json() == ACCOUNT
    assert len(fake_db.requests) == 1


def test_update_and_delete_unknown_accounts(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    assert api.patch(f"/mail/accounts/{ACCOUNT_ID}", json={"label": "x"}).status_code == 404
    assert api.delete(f"/mail/accounts/{ACCOUNT_ID}").status_code == 404


def test_delete(api: TestClient, fake_db: FakeSupabase, gmail: FakeGmail) -> None:
    fake_db.reply(200, [{"id": ACCOUNT_ID}])
    assert api.delete(f"/mail/accounts/{ACCOUNT_ID}").status_code == 204
    assert fake_db.last.method == "DELETE"
