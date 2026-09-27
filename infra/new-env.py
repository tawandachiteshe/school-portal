#!/usr/bin/env python3
"""Fill .env.production.example for a domain, with a fresh random value for every secret.

    python3 infra/new-env.py https://portal.tcfl.ac.zw > .env.production

Prints to stdout; keep the result out of git and paste it into Dokploy's Environment tab.
"""

import base64
import secrets
import sys
from pathlib import Path

if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
    sys.exit("usage: new-env.py https://portal.example.ac.zw")
origin = sys.argv[1].rstrip("/")
text = (Path(__file__).resolve().parent.parent / ".env.production.example").read_text()
text = text.replace("https://portal.tcfl.ac.zw", origin)


def token(n: int = 36) -> str:
    return secrets.token_urlsafe(n)


db_password = token(24)
values = {
    "SECRET_KEY": token(48),
    "POSTGRES_PASSWORD": db_password,
    "S3_SECRET_KEY": token(24),
    "OIDC_CLIENT_SECRET": token(48),
    "SESSION_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
    "AUTHENTIK_SECRET_KEY": token(48),
    "AUTHENTIK_PG_PASS": token(24),
    "AUTHENTIK_BOOTSTRAP_PASSWORD": token(18),
    "SMS_WEBHOOK_SECRET": token(32),
}
out = []
for line in text.splitlines():
    key = line.split("=", 1)[0]
    if key in values and line.endswith("=change-me"):
        line = f"{key}={values[key]}"
    if key == "DATABASE_URL":
        line = line.replace("change-me", db_password)
    out.append(line)
print("\n".join(out))
