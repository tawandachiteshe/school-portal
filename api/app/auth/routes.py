import logging
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.auth import oidc, sessions, sync
from app.config import get_settings
from app.crypto import decrypt
from app.db import DbDep
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("tcfl.auth")


SHARED_SESSION_SECONDS = 8 * 3600  # design/StaffSignIn "This is a shared computer"


def set_session_cookie(response: Response, value: str, persistent: bool = True) -> None:
    """persistent=False: a browser-session cookie, gone when the browser closes (shared computers)."""
    s = get_settings()
    response.set_cookie(
        sessions.COOKIE,
        value,
        httponly=True,
        secure=s.is_prod,
        samesite="lax",
        max_age=s.session_max_age if persistent else None,
        path="/",
    )


class LogoutOut(BaseModel):
    redirect: str


@router.post("/logout")
async def logout(request: Request, response: Response, db: DbDep) -> LogoutOut:
    """Ends the portal session, and Authentik's too (RP-initiated logout) when it signed the user in."""
    ws = await sessions.revoke(db, request.cookies.get(sessions.COOKIE))
    response.delete_cookie(sessions.COOKIE, path="/")
    after = f"{get_settings().app_url.rstrip('/')}/login"
    if ws and ws.id_token_enc:
        url = await oidc.end_session_url(decrypt(ws.id_token_enc), after)
        if url:
            return LogoutOut(redirect=url)
    return LogoutOut(redirect="/login")


# --- OIDC with Authentik (docs/10 §10.2) --------------------------------------------------------


@router.get("/login", response_class=RedirectResponse, status_code=302)
async def oidc_login(next: str = "/", shared: bool = False) -> RedirectResponse:
    """After the sign-in screens: Authentik has a session, so this comes straight back with a code."""
    try:
        d = await oidc.discovery()
    except httpx.HTTPError as e:
        raise HTTPException(503, "Sign-in isn't available right now. Try again in a minute.") from e
    cookie, query = oidc.begin(next, shared)
    r = RedirectResponse(f"{d.authorization_endpoint}?{query}", status_code=302)
    r.set_cookie(
        oidc.STATE_COOKIE,
        cookie,
        httponly=True,
        secure=get_settings().is_prod,
        samesite="lax",
        max_age=oidc.STATE_MAX_AGE,
        path="/",
    )
    return r


@router.get("/callback", response_class=RedirectResponse, status_code=302)
async def oidc_callback(
    request: Request,
    db: DbDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    saved = oidc.read_state(request.cookies.get(oidc.STATE_COOKIE))
    if error or not code or not saved or state != saved["state"]:
        return RedirectResponse("/login?error=signin", status_code=302)
    try:
        tokens = await oidc.exchange(code, saved)
    except Exception:
        log.exception("OIDC code exchange failed")
        return RedirectResponse("/login?error=signin", status_code=302)
    user = await sync.upsert_user(db, tokens.claims)
    if not user.roles:
        await db.commit()
        return RedirectResponse("/login?error=noaccess", status_code=302)
    value = await sessions.create(
        db,
        user,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        idp_sid=tokens.claims.get("sid"),
        refresh_token=tokens.refresh_token,
        id_token=tokens.id_token,
        access_expires_at=datetime.now(UTC) + timedelta(seconds=tokens.expires_in),
        max_age=SHARED_SESSION_SECONDS if saved.get("shared") else None,
    )
    r = RedirectResponse(saved["next"], status_code=302)
    set_session_cookie(r, value, persistent=not saved.get("shared"))
    r.delete_cookie(oidc.STATE_COOKIE, path="/")
    return r


class SignInOptions(BaseModel):
    """Ways to sign in besides a password. google: Authentik has a Google source."""

    google: bool


@router.get("/options")
async def sign_in_options() -> SignInOptions:
    return SignInOptions(google=bool(get_settings().google_client_id))


# --- development sign-in: pick a seeded account, no Authentik needed ------------------


def _require_dev_login() -> None:
    if not get_settings().dev_login_enabled:
        raise HTTPException(404)


class DevAccount(BaseModel):
    username: str
    display_name: str
    roles: list[str]


@router.get("/dev-accounts", dependencies=[Depends(_require_dev_login)])
async def dev_accounts(db: DbDep) -> list[DevAccount]:
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
async def dev_login(body: DevLoginIn, request: Request, response: Response, db: DbDep) -> dict[str, bool]:
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
