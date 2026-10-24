"""Mail API: the connected Gmail inboxes. App passwords are checked against Gmail before they are saved,
stored encrypted, and never returned."""

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import AfterValidator, BaseModel, StringConstraints

from app.core.supabase import SupabaseDep, one_or_404
from app.mail.crypto import CipherDep
from app.mail.imap import GmailDep, MailConnectionError, MailLoginError, http_error

router = APIRouter(prefix="/mail", tags=["mail"])

ACCOUNTS = "mail_accounts"
ACCOUNT_COLUMNS = "id,email,label,color,created_at"
MAX_ACCOUNTS = 5

Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]
Label = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
Color = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^#[0-9a-fA-F]{6}$")]


def _app_password(value: str) -> str:
    # Google shows app passwords in groups ("abcd efgh ijkl mnop"); the spaces aren't part of it.
    value = "".join(value.split())
    if not 1 <= len(value) <= 100:
        raise ValueError("Enter the app password")
    return value


AppPassword = Annotated[str, AfterValidator(_app_password)]


class AccountIn(BaseModel):
    email: Email
    app_password: AppPassword
    label: Label = ""
    color: Color = "#56a8f5"


class AccountPatch(BaseModel):
    label: Label | None = None
    color: Color | None = None
    app_password: AppPassword | None = None


class Account(BaseModel):
    id: UUID
    email: str
    label: str
    color: str
    created_at: datetime


@router.get("/accounts", response_model=list[Account])
def list_accounts(db: SupabaseDep) -> Any:
    return db.rest("GET", ACCOUNTS, params={"select": ACCOUNT_COLUMNS, "order": "created_at.asc"})


@router.post("/accounts", response_model=Account, status_code=status.HTTP_201_CREATED)
def create_account(body: AccountIn, db: SupabaseDep, cipher: CipherDep, gmail: GmailDep) -> Any:
    existing = db.rest("GET", ACCOUNTS, params={"select": "email"})
    if any(row["email"] == body.email for row in existing):
        raise HTTPException(status.HTTP_409_CONFLICT, "This inbox is already connected.")
    if len(existing) >= MAX_ACCOUNTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"You can connect up to {MAX_ACCOUNTS} inboxes.")
    try:
        gmail.check_login(body.email, body.app_password)
    except (MailLoginError, MailConnectionError) as exc:
        raise http_error(exc) from exc
    row = {
        "email": body.email,
        "label": body.label,
        "color": body.color,
        "password_enc": cipher.encrypt(body.app_password),
    }
    return db.rest("POST", ACCOUNTS, params={"select": ACCOUNT_COLUMNS}, json=row)[0]


@router.patch("/accounts/{account_id}", response_model=Account)
def update_account(account_id: UUID, body: AccountPatch, db: SupabaseDep, cipher: CipherDep, gmail: GmailDep) -> Any:
    params = {"id": f"eq.{account_id}", "select": ACCOUNT_COLUMNS}
    account = one_or_404(db.rest("GET", ACCOUNTS, params=params), "Inbox")
    changes: dict[str, Any] = body.model_dump(exclude_unset=True, exclude={"app_password"})
    changes = {k: v for k, v in changes.items() if v is not None}
    if body.app_password is not None:
        try:
            gmail.check_login(account["email"], body.app_password)
        except (MailLoginError, MailConnectionError) as exc:
            raise http_error(exc) from exc
        changes["password_enc"] = cipher.encrypt(body.app_password)
    if not changes:
        return account
    return one_or_404(db.rest("PATCH", ACCOUNTS, params=params, json=changes), "Inbox")


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: UUID, db: SupabaseDep) -> Response:
    one_or_404(db.rest("DELETE", ACCOUNTS, params={"id": f"eq.{account_id}", "select": "id"}), "Inbox")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
