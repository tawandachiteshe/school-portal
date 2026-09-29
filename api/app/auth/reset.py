"""Password reset by code (design/ForgotPassword): "We'll text a code to the mobile number on your
account. Then you choose a new password."

Authentik's recovery flow resets by email link; students and applicants mostly use their phones, so
the portal sends a 6-digit code by SMS, and by email too when the account has one and SMTP is set up
(app/mail.py), then sets the new password through the Authentik admin API. Answers never say
whether an account exists. Staff reset through ICT or their college email (the design says so).
"""

import logging
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import mail
from app.config import get_settings
from app.crypto import keyed_hash
from app.db import DbDep
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
    """Usernames the identifier could be: CC/2027/0142 as typed, or a mobile number as 263…"""
    raw = identifier.strip()
    out = [raw.upper(), raw]
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("0") and len(digits) == 10:
        digits = "263" + digits[1:]
    if re.fullmatch(r"2637\d{8}", digits):
        out.append(digits)
    return list(dict.fromkeys(out))


@dataclass
class Account:
    username: str  # Authentik username
    phone: str | None
    email: str | None


async def _find(db: AsyncSession, identifier: str) -> Account | None:
    """The account for a student number, mobile number or email, if it has a phone or email to send to."""
    names = _candidates(identifier)
    digits = re.sub(r"\D", "", identifier)
    phones = (
        [f"+263{digits[1:]}"]
        if digits.startswith("0") and len(digits) == 10
        else [f"+{digits}"]
        if digits
        else []
    )
    emails = [identifier.strip()] if "@" in identifier else []
    u = (
        (
            await db.execute(
                select(User).where(
                    or_(User.username.in_(names), User.phone.in_(phones), User.email.in_(emails)),
                    User.is_active,
                )
            )
        )
        .scalars()
        .first()
    )
    if (
        u
        and u.username
        and (u.phone or u.email)
        and not (u.roles and all(r.role not in ("student", "applicant") for r in u.roles))
    ):
        return Account(u.username, u.phone, u.email)
    # Signed up but never signed in to the portal: ask Authentik.
    async with _authentik() as c:
        lookups = [{"email": e} for e in emails] + [{"username": n} for n in names]
        for params in lookups:
            r = await c.get("core/users/", params=params)
            found = r.json().get("results", []) if r.status_code == 200 else []
            if not found or not found[0].get("is_active"):
                continue
            phone = found[0].get("attributes", {}).get("phone_number")
            email = found[0].get("email") or None
            if phone or email:
                return Account(found[0]["username"], phone, email)
    return None


class ResetStartIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=254)


class ResetStarted(BaseModel):
    """The same answer whether or not the account exists, so the page can't be used to find accounts."""

    minutes: int


@router.post("/start")
async def reset_start(body: ResetStartIn, db: DbDep) -> ResetStarted:
    found = await _find(db, body.identifier)
    if found is None:
        return ResetStarted(minutes=CODE_MINUTES)
    username = found.username
    now = datetime.now(UTC)
    recent = await db.scalar(
        select(func.count())
        .select_from(PasswordReset)
        .where(PasswordReset.username == username, PasswordReset.created_at > now - timedelta(hours=1))
    )
    if (recent or 0) >= MAX_PER_HOUR:
        raise HTTPException(429, "Too many codes. Wait an hour, or ask ICT Services, Block C.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    college = get_settings().college_name
    text = f"{college}: your password reset code is {code}. It expires in {CODE_MINUTES} minutes."
    # SMS and email both, where the account has them. Texts queue until an SMS provider is set up;
    # email goes only when SMTP is set up. Development logs both.
    if found.phone:
        db.add(SmsOutbox(to_phone=found.phone, body=text, purpose="reset"))
    db.add(
        PasswordReset(
            username=username,
            code_hash=keyed_hash(f"reset:{username}:{code}"),
            phone=found.phone,
            email=found.email,
            expires_at=now + timedelta(minutes=CODE_MINUTES),
        )
    )
    await db.commit()
    if found.phone and not get_settings().is_prod:
        log.warning("SMS to %s: reset code %s", found.phone, code)
    if found.email:
        await mail.send(
            found.email,
            "Campus Portal: your password reset code",
            f"{text}\n\nIf you didn't ask to reset your password, you can ignore this email.",
        )
    return ResetStarted(minutes=CODE_MINUTES)


class ResetFinishIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=254)
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=10, max_length=200)


class ResetDone(BaseModel):
    ok: bool


@router.post("/finish")
async def reset_finish(body: ResetFinishIn, db: DbDep) -> ResetDone:
    wrong = HTTPException(422, "That code isn't right, or it has expired. Ask for a new one.")
    found = await _find(db, body.identifier)
    if found is None:
        raise wrong
    username = found.username
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
