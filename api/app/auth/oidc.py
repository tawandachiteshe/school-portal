"""OpenID Connect with Authentik, as a confidential backend-for-frontend client (docs/10 §10.2, §10.6).

The React app signs the user in to Authentik with its own screens (the flow executor API). Then the
browser comes to /api/auth/login, which sends it to Authentik's authorize endpoint: Authentik already
has a session, so it returns straight away with a code. /api/auth/callback exchanges the code on the
back channel, checks the ID token, mirrors the user and their groups, and sets the portal cookie.

State, nonce and the PKCE verifier travel in a short-lived signed cookie, so no server-side session
store is needed before sign-in.
"""

import base64
import hashlib
import time
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from asyncer import asyncify
from itsdangerous import BadSignature, URLSafeTimedSerializer
from joserfc import jwt
from joserfc.jwk import KeySet, KeySetSerialization

from app.config import get_settings
from app.crypto import random_token

STATE_COOKIE = "portal_oidc"
STATE_MAX_AGE = 600

# Authentik group → portal role (docs/10 §10.3).
GROUP_ROLE = {
    "portal-applicants": "applicant",
    "portal-students": "student",
    "portal-lecturers": "lecturer",
    "portal-admissions": "admissions",
    "portal-registry": "registry",
    "portal-librarians": "librarian",
    "portal-student-affairs": "student_affairs",
    "portal-accounts": "accounts",
    "portal-admins": "admin",
}


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="oidc-state")


def _internal(url: str) -> str:
    """Public Authentik URL → the URL the API reaches it on (docs/10 §10.6 "Internal vs. public URL")."""
    base = get_settings().oidc_internal_base_url
    if not base:
        return url
    u, b = urlsplit(url), urlsplit(base)
    return urlunsplit((b.scheme, b.netloc, u.path, u.query, u.fragment))


@dataclass
class Discovery:
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    issuer: str


_discovery: tuple[float, Discovery] | None = None


async def discovery() -> Discovery:
    global _discovery
    if _discovery and time.monotonic() - _discovery[0] < 3600:
        return _discovery[1]
    s = get_settings()
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(
            _internal(f"{s.oidc_issuer}.well-known/openid-configuration"), headers=_public_headers()
        )
        r.raise_for_status()
        d = r.json()
    disc = Discovery(
        authorization_endpoint=d["authorization_endpoint"],
        token_endpoint=d["token_endpoint"],
        jwks_uri=d["jwks_uri"],
        issuer=d["issuer"],
    )
    _discovery = (time.monotonic(), disc)
    return disc


def _public_headers() -> dict[str, str]:
    """Authentik builds URLs and the token issuer from the request's host and scheme. The API reaches
    it over plain http inside Docker, so say which public address the call stands for: without the
    scheme, tokens behind an https proxy say "http://…" while the browser sees https://…, and
    Authentik rejects them where it compares the two (its end-session page did)."""
    public = urlsplit(get_settings().oidc_issuer)
    return {"Host": public.netloc, "X-Forwarded-Proto": public.scheme}


def begin(next_path: str, shared: bool = False) -> tuple[str, str]:
    """(state cookie value, authorize URL query). next must be a portal path, never another site."""
    if not next_path.startswith("/") or next_path.startswith("//"):
        next_path = "/"
    verifier = random_token(48)
    state = {
        "state": random_token(16),
        "nonce": random_token(16),
        "verifier": verifier,
        "next": next_path,
        "shared": shared,
    }
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    s = get_settings()
    query = urlencode(
        {
            "response_type": "code",
            "client_id": s.oidc_client_id,
            "redirect_uri": s.oidc_redirect_uri,
            "scope": "openid email profile offline_access",
            "state": state["state"],
            "nonce": state["nonce"],
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return _serializer().dumps(state), query


def read_state(cookie: str | None) -> dict | None:
    if not cookie:
        return None
    try:
        return _serializer().loads(cookie, max_age=STATE_MAX_AGE)
    except BadSignature:
        return None


@lru_cache(maxsize=4)
def _jwks_cached(uri: str, _hour: int) -> KeySetSerialization:
    r = httpx.get(_internal(uri), headers=_public_headers(), timeout=10)
    r.raise_for_status()
    return r.json()


@dataclass
class Tokens:
    claims: dict
    id_token: str
    refresh_token: str | None
    expires_in: int


async def exchange(code: str, state: dict) -> Tokens:
    s = get_settings()
    d = await discovery()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            _internal(d.token_endpoint),
            headers=_public_headers(),
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": s.oidc_redirect_uri,
                "code_verifier": state["verifier"],
                "client_id": s.oidc_client_id,
                "client_secret": s.oidc_client_secret,
            },
        )
        r.raise_for_status()
        t = r.json()
    # A blocking fetch (cached for the hour): in a worker thread, so sign-in never stalls other requests.
    keys = KeySet.import_key_set(await asyncify(_jwks_cached)(d.jwks_uri, int(time.time() // 3600)))
    claims = jwt.decode(t["id_token"], keys).claims
    jwt.JWTClaimsRegistry(
        leeway=60,
        iss={"essential": True, "value": d.issuer},
        aud={"essential": True, "value": s.oidc_client_id},
        nonce={"essential": True, "value": state["nonce"]},
        exp={"essential": True},
    ).validate(claims)
    return Tokens(
        claims=dict(claims),
        id_token=t["id_token"],
        refresh_token=t.get("refresh_token"),
        expires_in=int(t.get("expires_in", 300)),
    )
