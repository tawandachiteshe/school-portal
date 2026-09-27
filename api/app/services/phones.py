"""Zimbabwe mobile numbers: stored as E.164 (+263773184521), shown as 077 318 4521 or masked."""

import re


def local_phone(e164: str | None) -> str | None:
    """+263773184521 → '077 318 4521'"""
    if not e164 or not e164.startswith("+263") or len(e164) != 13:
        return None
    n = "0" + e164[4:]
    return f"{n[:3]} {n[3:6]} {n[6:]}"


def to_e164(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("263") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("07") and len(digits) == 10:
        return "+263" + digits[1:]
    if digits.startswith("7") and len(digits) == 9:
        return "+263" + digits
    return None


def mask(e164: str) -> str:
    """+263773184521 → '+263 77 ••• 4521', for pages that only need to confirm where a text goes."""
    return f"{e164[:4]} {e164[4:6]} ••• {e164[-4:]}"
