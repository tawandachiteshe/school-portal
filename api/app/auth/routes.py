from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import sessions
from app.config import get_settings
from app.db import get_db
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


def set_session_cookie(response: Response, value: str) -> None:
    s = get_settings()
    response.set_cookie(
        sessions.COOKIE,
        value,
        httponly=True,
        secure=s.is_prod,
        samesite="lax",
        max_age=s.session_max_age,
        path="/",
    )


class LogoutOut(BaseModel):
    redirect: str


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> LogoutOut:
    await sessions.revoke(db, request.cookies.get(sessions.COOKIE))
    response.delete_cookie(sessions.COOKIE, path="/")
    return LogoutOut(redirect="/login")


# --- development sign-in: pick a seeded account, no Authentik needed ------------------


def _require_dev_login() -> None:
    if not get_settings().dev_login_enabled:
        raise HTTPException(404)


class DevAccount(BaseModel):
    username: str
    display_name: str
    roles: list[str]


@router.get("/dev-accounts", dependencies=[Depends(_require_dev_login)])
async def dev_accounts(db: AsyncSession = Depends(get_db)) -> list[DevAccount]:
    users = (await db.execute(select(User).where(User.is_active).order_by(User.display_name))).scalars()
    return [
        DevAccount(
            username=u.username or "",
            display_name=u.display_name or "",
            roles=sorted(r.role for r in u.roles),
        )
        for u in users
        if u.username
    ]


class DevLoginIn(BaseModel):
    username: str


@router.post("/dev-login", dependencies=[Depends(_require_dev_login)])
async def dev_login(
    body: DevLoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> dict[str, bool]:
    user = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(404, "No such account")
    value = await sessions.create(
        db,
        user,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    set_session_cookie(response, value)
    return {"ok": True}
