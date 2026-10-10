import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.core import auth
from app.core.config import get_settings
from app.main import app

# Test key pair standing in for Supabase's signing key.
_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(autouse=True)
def fake_signing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "get_signing_key", lambda token: _PRIVATE_KEY.public_key())


def make_token(
    user_id: str | None = None,
    email: str = "user@example.com",
    expires_in: int = 3600,
    private_key: ec.EllipticCurvePrivateKey = _PRIVATE_KEY,
) -> str:
    now = int(time.time())
    claims = {
        "sub": user_id or str(uuid.uuid4()),
        "email": email,
        "aud": "authenticated",
        "iss": f"{get_settings().supabase_url}/auth/v1",
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(claims, private_key, algorithm="ES256")


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
