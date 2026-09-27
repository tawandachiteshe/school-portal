"""Backend-for-frontend sessions (docs/10 §10.2). The browser holds only an opaque cookie;
the database stores its sha256."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.crypto import encrypt, random_token, sha256
from app.models import User, WebSession

COOKIE = "portal_session"
# Avoid a write on every request: last_seen_at is bumped at most this often.
_TOUCH_EVERY = timedelta(minutes=5)


async def create(
    db: AsyncSession,
    user: User,
    *,
    ip: str | None = None,
    user_agent: str | None = None,
    idp_sid: str | None = None,
    refresh_token: str | None = None,
    id_token: str | None = None,
    access_expires_at: datetime | None = None,
    max_age: int | None = None,
) -> str:
    value = random_token()
    now = datetime.now(UTC)
    db.add(
        WebSession(
            user_id=user.id,
            cookie_hash=sha256(value),
            idp_sid=idp_sid,
            refresh_token_enc=encrypt(refresh_token) if refresh_token else None,
            id_token_enc=encrypt(id_token) if id_token else None,
            access_expires_at=access_expires_at,
            user_agent=user_agent,
            ip=ip,
            expires_at=now + timedelta(seconds=max_age or get_settings().session_max_age),
        )
    )
    user.last_login_at = now
    await db.commit()
    return value


async def resolve(db: AsyncSession, cookie: str | None) -> tuple[WebSession, User] | None:
    if not cookie:
        return None
    now = datetime.now(UTC)
    row = (
        await db.execute(
            select(WebSession, User)
            .join(User, User.id == WebSession.user_id)
            .where(
                WebSession.cookie_hash == sha256(cookie),
                WebSession.revoked_at.is_(None),
                WebSession.expires_at > now,
                User.is_active,
            )
        )
    ).first()
    if row is None:
        return None
    session, user = row
    if now - session.last_seen_at > _TOUCH_EVERY:
        session.last_seen_at = now
        await db.commit()
    return session, user


async def revoke(db: AsyncSession, cookie: str | None, reason: str = "logout") -> WebSession | None:
    if not cookie:
        return None
    session = (
        await db.execute(
            select(WebSession).where(
                WebSession.cookie_hash == sha256(cookie), WebSession.revoked_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if session:
        session.revoked_at = datetime.now(UTC)
        session.revoke_reason = reason
        await db.commit()
    return session


async def revoke_all_for_user(db: AsyncSession, user_id, reason: str) -> None:
    await db.execute(
        update(WebSession)
        .where(WebSession.user_id == user_id, WebSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoke_reason=reason)
    )
    await db.commit()
