"""Development only: create the seeded portal users in Authentik, so the real sign-in screens can be
tried with them. Run after `python -m app.seed`:

    uv run python -m app.authentik_dev

Every account gets the password in AUTHENTIK_DEV_PASSWORD (default tcfl-dev-2027). The portal user
is linked to the Authentik user (idp_subject, idp_user_pk), so signing in lands on the same data.
"""

import asyncio
import sys

import httpx
from sqlalchemy import select

from app.auth.oidc import GROUP_ROLE
from app.config import get_settings
from app.db import get_sessionmaker
from app.models import User

ROLE_GROUP = {v: k for k, v in GROUP_ROLE.items()}


def api() -> httpx.Client:
    s = get_settings()
    if not s.authentik_api_token or s.authentik_api_token == "change-me":
        sys.exit("Set AUTHENTIK_API_TOKEN (in development, the AUTHENTIK_BOOTSTRAP_TOKEN works).")
    return httpx.Client(
        base_url=s.authentik_api_url.rstrip("/") + "/",
        headers={"Authorization": f"Bearer {s.authentik_api_token}"},
        timeout=20,
    )


def group_pks(c: httpx.Client) -> dict[str, str]:
    out, page = {}, 1
    while True:
        r = c.get("core/groups/", params={"page": page, "page_size": 100}).json()
        out |= {g["name"]: g["pk"] for g in r["results"]}
        if not r["pagination"]["next"]:
            return out
        page += 1


async def main() -> None:
    s = get_settings()
    if s.is_prod:
        sys.exit("Refusing to create development accounts in production.")
    c = api()
    groups = group_pks(c)
    missing = sorted(set(ROLE_GROUP.values()) - set(groups))
    if missing:
        sys.exit(f"Authentik is missing groups {missing}: is the tcfl-portal blueprint applied?")
    async with get_sessionmaker()() as db:
        users = (await db.execute(select(User).where(User.username.is_not(None)))).scalars().all()
        for u in users:
            body = {
                "username": u.username,
                "name": u.display_name or u.username,
                "email": u.email or "",
                "is_active": True,
                "type": "internal",
                "groups": [groups[ROLE_GROUP[r.role]] for r in u.roles if r.role in ROLE_GROUP],
                "attributes": {"phone_number": u.phone} if u.phone else {},
            }
            found = c.get("core/users/", params={"username": u.username}).json()["results"]
            if found:
                pk = found[0]["pk"]
                c.patch(f"core/users/{pk}/", json=body).raise_for_status()
                uuid = found[0]["uuid"]
            else:
                r = c.post("core/users/", json=body)
                r.raise_for_status()
                pk, uuid = r.json()["pk"], r.json()["uuid"]
            c.post(
                f"core/users/{pk}/set_password/", json={"password": s.authentik_dev_password}
            ).raise_for_status()
            u.idp_user_pk, u.idp_subject = pk, uuid
            print(f"{u.username:<16} {', '.join(sorted(r.role for r in u.roles))}")
        await db.commit()
    print(f"Password for all: {s.authentik_dev_password}")


if __name__ == "__main__":
    asyncio.run(main())
