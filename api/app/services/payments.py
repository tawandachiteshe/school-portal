"""Mobile money for the application fee.

A gateway pushes a payment prompt to the applicant's phone and later reports whether it was
approved. No gateway is configured yet (design/Payment "[PAYMENT PROVIDER]"). Outside
production the development simulator stands in: it never moves money, approves a prompt a few
seconds after it's sent, and declines numbers ending in 0000 as "not enough money" so the
failure screens can be tried.
"""

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.config import get_settings
from app.services import clock


@dataclass
class PushResult:
    ref: str


@dataclass
class PushStatus:
    state: str  # pending | paid | failed
    receipt: str | None = None
    failure: str | None = None


class DevSimulator:
    name = "dev"
    label = "the development simulator (no real money moves)"
    APPROVE_AFTER = timedelta(seconds=6)

    def push(self, phone: str, amount: str, reference: str) -> PushResult:
        return PushResult(ref=f"SIM-{secrets.token_hex(4).upper()}")

    def status(self, ref: str, phone: str, sent_at: datetime) -> PushStatus:
        if clock.now() - sent_at < self.APPROVE_AFTER:
            return PushStatus("pending")
        if phone.endswith("0000"):
            return PushStatus("failed", failure="there isn't enough money in the wallet")
        return PushStatus("paid", receipt=f"EC-{int(sent_at.timestamp()) % 10_000_000:07d}")


def provider() -> DevSimulator | None:
    s = get_settings()
    name = s.payment_provider or ("" if s.is_prod else "dev")
    if name == "dev" and not s.is_prod:
        return DevSimulator()
    return None  # a real gateway (e.g. EcoCash/OneMoney via an aggregator) is added here
