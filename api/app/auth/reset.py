"""Password reset by SMS code (design/ForgotPassword): "We'll text a code to the mobile number on your
account. Then you choose a new password."

Authentik's recovery flow resets by email link; students and applicants use their phones, so the
portal texts the code and sets the new password through the Authentik admin API. Answers never say
whether an account exists. Staff reset through ICT or their TCFL email (the design says so).
"""

import logging
import re
import secrets
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.crypto import keyed_hash
from app.db import get_db
from app.models import PasswordReset, SmsOutbox, User

router = APIRouter(prefix="/auth/reset", tags=["auth"])
CODE_MINUTES = 10
MAX_ATTEMPTS = 5
MAX_PER_HOUR = 3
log = logging.getLogger("tcfl.sms")


def _authentik() -> httpx.AsyncClient:
    s = get_settings()
    if not s.authentik_api_token or s.authentik_api_token == "change-me":
        raise HTTPException(503, "Password reset isn't available right now. Ask ICT Services, Block C.")
    return httpx.AsyncClient(
        base_url=s.authentik_api_url.rstrip("/") + "/",
        headers={"Authorization": f"Bearer {s.authentik_api_token}"},
        timeout=15,
    )


def _candidates(identifier: str) -> list[str]:
    """Usernames the identifier could be: TCFL/2027/0142 as typed, or a mobile number as 263…"""
    raw = identifier.strip()
    out = [raw.upper(), raw]
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("0") and len(digits) == 10:
        digits = "263" + digits[1:]
    if re.fullmatch(r"2637\d{8}", digits):
        out.append(digits)
    return list(dict.fromkeys(out))


async def _find(db: AsyncSession, identifier: str) -> tuple[str, str] | None:
    """(Authentik username, phone) for a student number or mobile number, if it's an account with a phone."""
    names = _candidates(identifier)
    digits = re.sub(r"\D", "", identifier)
    phones = (
        [f"+263{digits[1:]}"]
        if digits.startswith("0") and len(digits) == 10
        else [f"+{digits}"]
        if digits
        else []
    )
    u = (
        (
            await db.execute(
                select(User).where(or_(User.username.in_(names), User.phone.in_(phones)), User.is_active)
            )
        )
        .scalars()
        .first()
    )
    if (
        u
        and u.username
        and u.phone
        and not (u.roles and all(r.role not in ("student", "applicant") for r in u.roles))
    ):
        return u.username, u.phone
    # Signed up but never signed in to the portal: ask Authentik.
    async with _authentik() as c:
        for name in names:
            r = await c.get("core/users/", params={"username": name})
            found = r.json().get("results", []) if r.status_code == 200 else []
            phone = found[0].get("attributes", {}).get("phone_number") if found else None
            if found and found[0].get("is_active") and phone:
                return found[0]["username"], phone
    return None


class ResetStartIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=40)


class ResetStarted(BaseModel):
    """The same answer whether or not the account exists, so the page can't be used to find accounts."""

    minutes: int


@router.post("/start")
async def reset_start(body: ResetStartIn, db: AsyncSession = Depends(get_db)) -> ResetStarted:
    found = await _find(db, body.identifier)
    if found is None:
        return ResetStarted(minutes=CODE_MINUTES)
    username, phone = found
    now = datetime.now(UTC)
    recent = await db.scalar(
        select(func.count())
        .select_from(PasswordReset)
        .where(PasswordReset.username == username, PasswordReset.created_at > now - timedelta(hours=1))
    )
    if (recent or 0) >= MAX_PER_HOUR:
        raise HTTPException(429, "Too many codes. Wait an hour, or ask ICT Services, Block C.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(
        PasswordReset(
            username=username,
            code_hash=keyed_hash(f"reset:{username}:{code}"),
            phone=phone,
            expires_at=now + timedelta(minutes=CODE_MINUTES),
        )
    )
    db.add(
        SmsOutbox(
            to_phone=phone,
            body=f"TCFL: your password reset code is {code}. It expires in {CODE_MINUTES} minutes.",
            purpose="reset",
        )
    )
    await db.commit()
    if not get_settings().is_prod:
        log.warning("SMS to %s: reset code %s", phone, code)
    return ResetStarted(minutes=CODE_MINUTES)


class ResetFinishIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=40)
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=10, max_length=200)


class ResetDone(BaseModel):
    ok: bool


@router.post("/finish")
async def reset_finish(body: ResetFinishIn, db: AsyncSession = Depends(get_db)) -> ResetDone:
    wrong = HTTPException(422, "That code isn't right, or it has expired. Ask for a new one.")
    found = await _find(db, body.identifier)
    if found is None:
        raise wrong
    username = found[0]
    now = datetime.now(UTC)
    r = (
        (
            await db.execute(
                select(PasswordReset)
                .where(
                    PasswordReset.username == username,
                    PasswordReset.used_at.is_(None),
                    PasswordReset.expires_at > now,
                )
                .order_by(PasswordReset.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if r is None or r.attempts >= MAX_ATTEMPTS:
        raise wrong
    if r.code_hash != keyed_hash(f"reset:{username}:{body.code}"):
        r.attempts += 1
        await db.commit()
        raise wrong
    async with _authentik() as c:
        u = (await c.get("core/users/", params={"username": username})).json()["results"]
        if not u:
            raise wrong
        res = await c.post(f"core/users/{u[0]['pk']}/set_password/", json={"password": body.password})
        if res.status_code >= 400:
            detail = res.json() if "json" in res.headers.get("content-type", "") else {}
            msg = (
                next(iter(detail.values()), ["Choose a different password."])
                if isinstance(detail, dict)
                else None
            )
            raise HTTPException(
                422, msg[0] if isinstance(msg, list) and msg else "Choose a different password."
            )
    r.used_at = now
    await db.commit()
    return ResetDone(ok=True)
