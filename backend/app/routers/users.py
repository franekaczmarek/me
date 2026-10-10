from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import CurrentUserDep

router = APIRouter(tags=["users"])


class Me(BaseModel):
    id: str
    email: str | None


@router.get("/me", response_model=Me)
def read_me(user: CurrentUserDep) -> Me:
    return Me(id=user.id, email=user.email)
