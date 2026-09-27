"""audit_log (docs/07 "Audit log"): who looked at or changed what, when, from where."""

import json

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser


async def record(
    db: AsyncSession,
    cu: CurrentUser,
    request: Request,
    action: str,
    entity: str,
    entity_id: str | None,
    after: dict | None = None,
) -> None:
    """Added to the caller's transaction: it's written when they commit."""
    roles = sorted(cu.roles)
    await db.execute(
        text(
            "INSERT INTO audit_log (actor_id, actor_role, action, entity, entity_id, after, ip, user_agent) "
            "VALUES (:actor, CAST(:role AS user_role), :action, :entity, :entity_id, CAST(:after AS jsonb), "
            "CAST(:ip AS inet), :ua)"
        ),
        {
            "actor": cu.user.id,
            "role": roles[0] if roles else None,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "after": json.dumps(after) if after is not None else None,
            "ip": request.client.host if request.client else None,
            "ua": request.headers.get("user-agent"),
        },
    )
