from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from tests.conftest import make_token


def test_me_returns_user_from_valid_token(client: TestClient) -> None:
    token = make_token(user_id="11111111-1111-1111-1111-111111111111", email="a@b.com")
    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"id": "11111111-1111-1111-1111-111111111111", "email": "a@b.com"}


def test_me_requires_token(client: TestClient) -> None:
    assert client.get("/me").status_code == 401


def test_me_rejects_expired_token(client: TestClient) -> None:
    token = make_token(expires_in=-60)
    assert client.get("/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_me_rejects_token_signed_with_other_key(client: TestClient) -> None:
    token = make_token(private_key=ec.generate_private_key(ec.SECP256R1()))
    assert client.get("/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_me_rejects_garbage_token(client: TestClient) -> None:
    assert client.get("/me", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401
