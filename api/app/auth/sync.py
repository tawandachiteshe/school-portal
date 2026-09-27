"""Mirror an Authentik user into the portal (docs/10 §10.4, §10.5): users/people rows, and user_roles
rewritten from the `groups` claim at every sign-in."""

import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.oidc import GROUP_ROLE
from app.models import Person, User, UserRole


def _phone(username: str | None, claims: dict) -> str | None:
    """Applicants sign up with their mobile number as username (263773184521, docs/design-handoff.md)."""
    raw = claims.get("phone_number") or (
        username if username and re.fullmatch(r"2637\d{8}", username) else None
    )
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    return f"+{digits}" if re.fullmatch(r"[1-9]\d{7,14}", digits) else None


async def upsert_user(db: AsyncSession, claims: dict) -> User:
    sub = claims["sub"]
    username = claims.get("preferred_username")
    user = (await db.execute(select(User).where(User.idp_subject == sub))).scalar_one_or_none()
    if user is None and username:
        # First sign-in of an account the portal already knows (imported or seeded): link it.
        user = (
            await db.execute(select(User).where(User.username == username, User.idp_subject.like("seed:%")))
        ).scalar_one_or_none()
        if user is not None:
            user.idp_subject = sub
    if user is None:
        user = User(idp_subject=sub)
        db.add(user)
    now = datetime.now(UTC)
    user.username = username or user.username
    user.email = claims.get("email") or user.email
    user.email_verified = bool(claims.get("email_verified")) or user.email_verified
    user.display_name = claims.get("name") or user.display_name
    user.phone = _phone(username, claims) or user.phone
    user.claims_synced_at = now
    groups = claims.get("groups") or []
    roles = sorted({GROUP_ROLE[g] for g in groups if g in GROUP_ROLE})
    user.roles = [UserRole(role=r, idp_group=next(g for g, x in GROUP_ROLE.items() if x == r)) for r in roles]
    await db.flush()
    person = (await db.execute(select(Person).where(Person.user_id == user.id))).scalar_one_or_none()
    if person is None:
        first, _, last = (claims.get("name") or username or "").strip().rpartition(" ")
        db.add(
            Person(user_id=user.id, first_names=first or last or "Applicant", surname=last if first else "")
        )
    await db.flush()
    return user
