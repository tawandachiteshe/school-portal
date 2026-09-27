"""Server-to-server endpoints (not called by browsers; CSRF-exempt under /internal/)."""

import hmac
import logging
import re

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import SmsOutbox

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)
log = logging.getLogger("tcfl.sms")


class Queued(BaseModel):
    queued: bool


@router.post("/sms")
async def authentik_sms(
    request: Request, authorization: str = Header(default=""), db: AsyncSession = Depends(get_db)
) -> Queued:
    """Authentik's generic SMS provider (sign-up phone check, password reset) posts
    {"From", "To", "Body"} here. The text joins the SMS queue that the SMS worker sends once a
    provider is configured (SMS_PROVIDER)."""
    s = get_settings()
    token = authorization.removeprefix("Bearer ").strip()
    if not s.sms_webhook_secret or not hmac.compare_digest(token, s.sms_webhook_secret):
        raise HTTPException(401)
    data = (
        await request.json()
        if "json" in request.headers.get("content-type", "")
        else dict(await request.form())
    )
    to = re.sub(r"[^\d+]", "", str(data.get("To") or data.get("to") or data.get("phone") or ""))
    body = str(data.get("Body") or data.get("body") or data.get("message") or "")
    if not to.startswith("+"):
        to = "+" + to
    if not re.fullmatch(r"\+[1-9]\d{7,14}", to) or not body:
        raise HTTPException(422, "Need To and Body")
    db.add(SmsOutbox(to_phone=to, body=body, purpose="authentik"))
    await db.commit()
    if not s.is_prod:
        # No SMS provider in development: the code is shown here so sign-up can be tried.
        log.warning("SMS to %s: %s", to, body)
    return Queued(queued=True)
