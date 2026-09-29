"""Sign-in with Authentik (docs/10): OIDC state and ID-token checks, the callback, the SMS webhook,
and password reset by SMS code. Authentik itself is replaced by fakes."""

import time
from urllib.parse import parse_qs

import httpx
import pytest
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet, RSAKey

from app import mail
from app.auth import oidc, reset
from app.auth.oidc import Discovery, Tokens
from app.config import get_settings
from tests.helpers import client

pytestmark = pytest.mark.anyio

ISSUER = "http://localhost:5173/auth/application/o/tcfl-portal/"
DISCOVERY = Discovery(
    authorization_endpoint="http://localhost:5173/auth/application/o/authorize/",
    token_endpoint="http://localhost:5173/auth/application/o/token/",
    jwks_uri="http://localhost:5173/auth/application/o/tcfl-portal/jwks/",
    issuer=ISSUER,
)


@pytest.fixture
def fake_discovery(monkeypatch):
    async def disc():
        return DISCOVERY

    monkeypatch.setattr(oidc, "discovery", disc)


# --- state -----------------------------------------------------------------------------------


@pytest.mark.parametrize("given", ["https://evil.example/", "//evil.example/x", "staff"])
def test_next_is_only_ever_a_portal_path(given):
    cookie, _ = oidc.begin(given)
    assert oidc.read_state(cookie)["next"] == "/"


def test_state_cookie_carries_pkce_and_is_signed():
    cookie, query = oidc.begin("/staff/library", shared=True)
    state = oidc.read_state(cookie)
    q = parse_qs(query)
    assert state["next"] == "/staff/library" and state["shared"] is True
    assert q["state"] == [state["state"]] and q["nonce"] == [state["nonce"]]
    assert q["code_challenge_method"] == ["S256"] and "offline_access" in q["scope"][0]
    assert oidc.read_state(cookie[:-2] + "xx") is None
    assert oidc.read_state(None) is None


# --- ID token checks -------------------------------------------------------------------------

KEY = RSAKey.generate_key(2048, parameters={"kid": "test"})


def _id_token(**over) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": get_settings().oidc_client_id,
        "sub": "abc",
        "nonce": "n1",
        "iat": now,
        "exp": now + 300,
    } | over
    return jwt.encode({"alg": "RS256", "kid": "test"}, claims, KEY)


@pytest.fixture
def token_endpoint(monkeypatch, fake_discovery):
    """Authentik's token endpoint answers with whatever ID token the test sets."""
    answer: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert b"code_verifier=v1" in request.content
        return httpx.Response(
            200, json={"id_token": answer["id_token"], "refresh_token": "r1", "expires_in": 300}
        )

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(oidc, "_jwks_cached", lambda uri, hour: KeySet([KEY]).as_dict(private=False))
    return answer


async def test_exchange_accepts_a_good_id_token(token_endpoint):
    token_endpoint["id_token"] = _id_token()
    t = await oidc.exchange("code", {"verifier": "v1", "nonce": "n1"})
    assert t.claims["sub"] == "abc" and t.refresh_token == "r1"


@pytest.mark.parametrize(
    "over",
    [
        {"nonce": "replayed"},
        {"aud": "another-app"},
        {"iss": "http://evil/"},
        {"exp": int(time.time()) - 3600},
    ],
)
async def test_exchange_rejects_a_bad_id_token(token_endpoint, over):
    token_endpoint["id_token"] = _id_token(**over)
    with pytest.raises(JoseError):
        await oidc.exchange("code", {"verifier": "v1", "nonce": "n1"})


async def test_exchange_rejects_a_token_signed_by_another_key(token_endpoint):
    other = RSAKey.generate_key(2048, parameters={"kid": "test"})
    now = int(time.time())
    token_endpoint["id_token"] = jwt.encode(
        {"alg": "RS256", "kid": "test"},
        {"iss": ISSUER, "aud": get_settings().oidc_client_id, "sub": "x", "nonce": "n1", "exp": now + 300},
        other,
    )
    with pytest.raises(JoseError):
        await oidc.exchange("code", {"verifier": "v1", "nonce": "n1"})


# --- callback --------------------------------------------------------------------------------


async def _callback(monkeypatch, c: httpx.AsyncClient, claims: dict) -> httpx.Response:
    async def exchange(code, state):
        return Tokens(claims=claims, id_token="id", refresh_token="r", expires_in=300)

    monkeypatch.setattr(oidc, "exchange", exchange)
    cookie, query = oidc.begin("/apply")
    c.cookies[oidc.STATE_COOKIE] = cookie
    state = parse_qs(query)["state"][0]
    return await c.get(f"/auth/callback?code=abc&state={state}")


async def test_callback_with_the_wrong_state_goes_back_to_sign_in():
    cookie, _ = oidc.begin("/apply")
    async with client() as c:
        c.cookies[oidc.STATE_COOKIE] = cookie
        r = await c.get("/auth/callback?code=abc&state=forged")
    assert r.status_code == 302 and r.headers["location"] == "/login?error=signin"


async def test_callback_signs_in_a_new_applicant(monkeypatch):
    claims = {
        "sub": "ak-new-applicant",
        "preferred_username": "263779990001",
        "name": "Nyasha Dube",
        "groups": ["portal-applicants", "some-other-group"],
    }
    async with client() as c:
        r = await _callback(monkeypatch, c, claims)
        assert r.status_code == 302 and r.headers["location"] == "/apply"
        me = (await c.get("/me")).json()
    assert me["roles"] == ["applicant"]
    assert me["display_name"] == "Nyasha Dube"
    assert me["phone"] == "+263779990001"


async def test_callback_links_a_seeded_account_and_takes_roles_from_groups(monkeypatch):
    claims = {
        "sub": "ak-fchikore",
        "preferred_username": "fchikore",
        "groups": ["portal-lecturers", "portal-accounts"],
    }
    async with client() as c:
        await _callback(monkeypatch, c, claims)
        me = (await c.get("/me")).json()
    assert me["roles"] == ["accounts", "lecturer"]
    assert me["staff"]["short_name"] == "Eng. F. Chikore"  # the seeded account, not a new one


async def test_callback_without_a_portal_group_has_no_access(monkeypatch):
    async with client() as c:
        r = await _callback(
            monkeypatch, c, {"sub": "ak-nobody", "preferred_username": "nobody", "groups": []}
        )
        assert r.headers["location"] == "/login?error=noaccess"
        assert (await c.get("/me")).status_code == 401


# --- SMS webhook -----------------------------------------------------------------------------


async def test_sms_webhook_needs_the_secret():
    async with client() as c:
        r = await c.post(
            "/internal/sms",
            json={"To": "+263771234567", "Body": "123456"},
            headers={"Authorization": "Bearer wrong"},
        )
    assert r.status_code == 401


async def test_sms_webhook_queues_the_text():
    secret = get_settings().sms_webhook_secret
    async with client() as c:
        r = await c.post(
            "/internal/sms",
            json={"From": "Campus", "To": "263771234567", "Body": "Your code is 123456"},
            headers={"Authorization": f"Bearer {secret}"},
        )
    assert r.status_code == 200 and r.json() == {"queued": True}


# --- password reset --------------------------------------------------------------------------


class FakeAuthentik:
    """The Authentik admin API calls reset makes: find the user, set the password."""

    def __init__(self, users: dict[str, dict]):
        self.users = users
        self.passwords: dict[int, str] = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return None

    async def get(self, path, params=None):
        found = [u for u in self.users.values() if all(u.get(k) == v for k, v in params.items())]
        return httpx.Response(200, json={"results": found})

    async def post(self, path, json=None):
        pk = int(path.split("/")[2])
        if len(json["password"]) < 12 and "password" in json["password"]:
            return httpx.Response(400, json={"password": ["That password is too easy to guess."]})
        self.passwords[pk] = json["password"]
        return httpx.Response(204)


@pytest.fixture
def authentik(monkeypatch):
    fake = FakeAuthentik(
        {
            "263779990002": {
                "pk": 42,
                "username": "263779990002",
                "is_active": True,
                "attributes": {"phone_number": "+263779990002"},
            }
        }
    )
    monkeypatch.setattr(reset, "_authentik", lambda: fake)
    monkeypatch.setattr(reset.secrets, "randbelow", lambda n: 123456)
    return fake


async def test_reset_answers_the_same_for_unknown_accounts(authentik):
    async with client() as c:
        await c.get("/healthz")
        c.headers["X-CSRF-Token"] = c.cookies["portal_csrf"]
        r = await c.post("/auth/reset/start", json={"identifier": "0770000000"})
    assert r.status_code == 200 and r.json() == {"minutes": 10}


async def test_reset_by_sms_code(authentik):
    async with client() as c:
        await c.get("/healthz")
        c.headers["X-CSRF-Token"] = c.cookies["portal_csrf"]
        assert (await c.post("/auth/reset/start", json={"identifier": "077 999 0002"})).json() == {
            "minutes": 10
        }
        wrong = await c.post(
            "/auth/reset/finish",
            json={"identifier": "0779990002", "code": "000000", "password": "blue river mango"},
        )
        assert wrong.status_code == 422
        weak = await c.post(
            "/auth/reset/finish",
            json={"identifier": "0779990002", "code": "123456", "password": "password12"},
        )
        assert weak.status_code == 422 and weak.json()["detail"] == "That password is too easy to guess."
        ok = await c.post(
            "/auth/reset/finish",
            json={"identifier": "0779990002", "code": "123456", "password": "blue river mango"},
        )
        assert ok.json() == {"ok": True}
        again = await c.post(
            "/auth/reset/finish",
            json={"identifier": "0779990002", "code": "123456", "password": "blue river mango"},
        )
        assert again.status_code == 422  # a code works once
    assert authentik.passwords == {42: "blue river mango"}


async def test_reset_codes_stop_after_five_wrong_tries(authentik):
    async with client() as c:
        await c.get("/healthz")
        c.headers["X-CSRF-Token"] = c.cookies["portal_csrf"]
        authentik.users["263779990003"] = {
            "pk": 43,
            "username": "263779990003",
            "is_active": True,
            "attributes": {"phone_number": "+263779990003"},
        }
        await c.post("/auth/reset/start", json={"identifier": "0779990003"})
        for _ in range(5):
            await c.post(
                "/auth/reset/finish",
                json={"identifier": "0779990003", "code": "000000", "password": "blue river mango"},
            )
        r = await c.post(
            "/auth/reset/finish",
            json={"identifier": "0779990003", "code": "123456", "password": "blue river mango"},
        )
    assert r.status_code == 422 and 43 not in authentik.passwords


async def test_reset_by_email(authentik):
    authentik.users["263779990004"] = {
        "pk": 44,
        "username": "263779990004",
        "email": "nyasha.dube@gmail.com",
        "is_active": True,
        "attributes": {"phone_number": "+263779990004"},
    }
    async with client() as c:
        await c.get("/healthz")
        c.headers["X-CSRF-Token"] = c.cookies["portal_csrf"]
        await c.post("/auth/reset/start", json={"identifier": "nyasha.dube@gmail.com"})
        r = await c.post(
            "/auth/reset/finish",
            json={"identifier": "nyasha.dube@gmail.com", "code": "123456", "password": "blue river mango"},
        )
    assert r.json() == {"ok": True} and authentik.passwords[44] == "blue river mango"


async def test_sign_in_options_follow_the_google_setting(monkeypatch):
    async with client() as c:
        assert (await c.get("/auth/options")).json() == {"google": False}
        monkeypatch.setattr(get_settings(), "google_client_id", "x.apps.googleusercontent.com")
        assert (await c.get("/auth/options")).json() == {"google": True}


@pytest.fixture
def email_only(authentik):
    """A Google sign-up: an email address and no mobile number."""
    authentik.users["rudo.google@gmail.com"] = {
        "pk": 45,
        "username": "rudo.google@gmail.com",
        "email": "rudo.google@gmail.com",
        "is_active": True,
        "attributes": {},
    }
    return authentik


async def _start(identifier: str) -> httpx.Response:
    async with client() as c:
        await c.get("/healthz")
        c.headers["X-CSRF-Token"] = c.cookies["portal_csrf"]
        return await c.post("/auth/reset/start", json={"identifier": identifier})


async def test_reset_code_is_emailed_when_smtp_is_set_up(email_only, monkeypatch):
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.example.org")
    monkeypatch.setattr(mail, "_send", lambda to, subject, body: sent.append((to, subject, body)))
    assert (await _start("rudo.google@gmail.com")).json() == {"minutes": 10}
    assert sent and sent[0][0] == "rudo.google@gmail.com" and "123456" in sent[0][2]


async def test_without_smtp_nothing_is_emailed(email_only, monkeypatch):
    sent: list = []
    monkeypatch.setattr(mail, "_send", lambda *a: sent.append(a))
    assert (await _start("rudo.google@gmail.com")).json() == {"minutes": 10}
    assert sent == []


async def test_a_recreated_authentik_account_keeps_the_same_portal_user(monkeypatch):
    first = {
        "sub": "ak-first",
        "preferred_username": "263779990031",
        "name": "Rudo Dube",
        "groups": ["portal-applicants"],
    }
    async with client() as c:
        await _callback(monkeypatch, c, first)
        before = (await c.get("/me")).json()
    # ICT deletes the account and makes it again: same username, new Authentik id.
    again = {**first, "sub": "ak-second"}
    async with client() as c:
        r = await _callback(monkeypatch, c, again)
        after = (await c.get("/me")).json()
    assert r.status_code == 302 and after["id"] == before["id"] and after["phone"] == "+263779990031"


async def test_a_number_on_another_account_does_not_break_sign_in(monkeypatch):
    # A different username (an email) whose phone_number claim is a number someone already has.
    claims = {
        "sub": "ak-google-1",
        "preferred_username": "rudo@example.org",
        "phone_number": "+263779990031",
        "groups": ["portal-applicants"],
    }
    async with client() as c:
        r = await _callback(monkeypatch, c, claims)
        me = (await c.get("/me")).json()
    assert r.headers["location"] == "/apply" and me["phone"] is None
