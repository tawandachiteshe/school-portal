"""Email from the portal. Sent only when SMTP_HOST is set; otherwise nothing goes out (development
logs it instead), the same as texts before an SMS provider is configured."""

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.config import get_settings

log = logging.getLogger("tcfl.mail")


def configured() -> bool:
    return bool(get_settings().smtp_host)


def _send(to: str, subject: str, body: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
        if s.smtp_use_tls:
            smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)


async def send(to: str, subject: str, body: str) -> bool:
    """True if the email was handed to the SMTP server."""
    if not configured():
        if not get_settings().is_prod:
            log.warning("Email to %s (no SMTP_HOST, not sent): %s", to, body)
        return False
    try:
        await asyncio.to_thread(_send, to, subject, body)
    except (OSError, smtplib.SMTPException):
        log.exception("Email to %s failed", to)
        return False
    return True
