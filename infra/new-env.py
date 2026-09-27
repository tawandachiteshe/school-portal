#!/usr/bin/env python3
"""Fill .env.production.example for a domain, with a fresh random value for every secret.

    python3 infra/new-env.py https://portal.tcfl.ac.zw > .env.production
    python3 infra/new-env.py --demo https://tcfl.example.com id.example.com > .env.production   # pitch site

The second, optional argument is the host for Authentik's admin console (default id.<app host>).

--demo: sample data allowed (DEMO=true), student portal shown, and an Authentik admin token made on
first start (AUTHENTIK_BOOTSTRAP_TOKEN), which the API uses to create the sample accounts' sign-ins.

Prints to stdout; keep the result out of git and paste it into Dokploy's Environment tab.
"""

import base64
import secrets
import sys
from pathlib import Path

args = sys.argv[1:]
demo = "--demo" in args
args = [a for a in args if a != "--demo"]
if len(args) not in (1, 2) or not args[0].startswith("https://"):
    sys.exit("usage: new-env.py [--demo] https://portal.example.ac.zw [id.example.ac.zw]")
origin = args[0].rstrip("/")
app_host = origin.removeprefix("https://")
id_host = args[1] if len(args) == 2 else f"id.{app_host}"
text = (Path(__file__).resolve().parent.parent / ".env.production.example").read_text()
text = text.replace("ID_HOST=id.portal.tcfl.ac.zw", f"ID_HOST={id_host}")
text = text.replace("https://portal.tcfl.ac.zw", origin).replace("APP_HOST=portal.tcfl.ac.zw", f"APP_HOST={app_host}")


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
# A pitch site's settings replace the template's, whatever it says.
demo_values = {}
if demo:
    api_token = token(48)
    demo_values = {
        "DEMO": "true",
        "STUDENT_PORTAL_OPEN": "true",
        "AUTHENTIK_BOOTSTRAP_TOKEN": api_token,
        "AUTHENTIK_API_TOKEN": api_token,
    }

out = []
for line in text.splitlines():
    key = line.split("=", 1)[0]
    if key in demo_values:
        line = f"{key}={demo_values[key]}"
    elif key in values and line.endswith("=change-me"):
        line = f"{key}={values[key]}"
    elif key == "DATABASE_URL":
        line = line.replace("change-me", db_password)
    out.append(line)
print("\n".join(out))
