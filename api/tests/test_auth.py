import pytest

from tests.helpers import client, signed_in

pytestmark = pytest.mark.anyio


async def test_me_requires_a_session():
    async with client() as c:
        assert (await c.get("/me")).status_code == 401


async def test_state_changing_requests_need_the_csrf_header():
    async with client() as c:
        await c.get("/healthz")
        r = await c.post("/auth/dev-login", json={"username": "TCFL/2027/0142"})
        assert r.status_code == 403


async def test_student_me():
    async with signed_in("TCFL/2027/0142") as c:
        me = (await c.get("/me")).json()
    assert me["display_name"] == "Tariro Moyo"
    assert me["initials"] == "TM"
    assert me["roles"] == ["applicant", "student"]  # her application is still on record
    assert me["student"] == {
        "student_number": "TCFL/2027/0142",
        "programme_code": "DIT",
        "programme_name": "Diploma in Information Technology",
        "class_group": "DIT-1A",
        "year_of_study": 1,
    }
    assert me["staff"] is None


async def test_lecturer_me():
    async with signed_in("fchikore") as c:
        me = (await c.get("/me")).json()
    assert me["roles"] == ["lecturer"]
    assert me["staff"]["short_name"] == "Eng. F. Chikore"
    assert me["staff"]["position"] == "Lecturer · Data Communications"


async def test_logout_revokes_the_session():
    async with signed_in("cmarufu") as c:
        assert (await c.get("/me")).status_code == 200
        cookie = c.cookies["portal_session"]
        assert (await c.post("/auth/logout")).json() == {"redirect": "/login"}
        c.cookies.set("portal_session", cookie)  # replaying the old cookie must not work
        assert (await c.get("/me")).status_code == 401


async def test_dev_accounts_lists_seeded_users():
    async with client() as c:
        accounts = (await c.get("/auth/dev-accounts")).json()
    names = {a["username"] for a in accounts}
    assert {"TCFL/2027/0142", "fchikore", "cmarufu", "schinembiri", "tmushonga"} <= names


async def test_me_includes_the_current_term_week():
    async with signed_in("TCFL/2027/0142") as c:
        term = (await c.get("/me")).json()["term"]
    assert term["name"] == "Semester 1 2027"
    assert term["week"] == 6
    assert term["weeks"] == 16


async def test_sms_reminders_setting_round_trips():
    async with signed_in("TCFL/2027/0142") as c:
        assert (await c.get("/me/settings")).json() == {"sms_reminders": True}
        assert (await c.patch("/me/settings", json={"sms_reminders": False})).json() == {
            "sms_reminders": False
        }
        assert (await c.get("/me/settings")).json() == {"sms_reminders": False}
        await c.patch("/me/settings", json={"sms_reminders": True})


# --- signing out of Authentik behind an https proxy ---------------------------------------------

HTTPS_ISSUER = "https://portal.example/auth/application/o/tcfl-portal/"


def _token(iss: str) -> str:
    import base64
    import json

    body = base64.urlsafe_b64encode(json.dumps({"iss": iss}).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJSUzI1NiJ9.{body}.sig"


@pytest.fixture
def https_authentik(monkeypatch):
    import time
    from types import SimpleNamespace

    from app.auth import oidc

    monkeypatch.setattr(oidc, "get_settings", lambda: SimpleNamespace(oidc_issuer=HTTPS_ISSUER))
    disc = oidc.Discovery(
        authorization_endpoint="https://portal.example/auth/application/o/authorize/",
        token_endpoint="https://portal.example/auth/application/o/token/",
        jwks_uri="https://portal.example/auth/application/o/tcfl-portal/jwks/",
        end_session_endpoint=f"{HTTPS_ISSUER}end-session/",
        issuer=HTTPS_ISSUER,
    )
    monkeypatch.setattr(oidc, "_discovery", (time.monotonic(), disc))
    return oidc


def test_calls_to_authentik_say_the_public_scheme(https_authentik):
    # Otherwise Authentik issues "http://" tokens that its own https logout page rejects.
    assert https_authentik._public_headers() == {"Host": "portal.example", "X-Forwarded-Proto": "https"}


async def test_logout_sends_a_token_from_this_issuer_and_comes_back(https_authentik):
    url = await https_authentik.end_session_url(_token(HTTPS_ISSUER), "https://portal.example/login")
    assert url.startswith(f"{HTTPS_ISSUER}end-session/?")
    assert "id_token_hint=" in url and "post_logout_redirect_uri=https%3A%2F%2Fportal.example%2Flogin" in url


async def test_logout_with_a_token_from_another_issuer_skips_the_hint(https_authentik):
    # Sessions from before the fix hold "http://" tokens: Authentik would answer "malformed request".
    old = _token(HTTPS_ISSUER.replace("https://", "http://"))
    assert (
        await https_authentik.end_session_url(old, "https://portal.example/login")
        == f"{HTTPS_ISSUER}end-session/"
    )
    assert await https_authentik.end_session_url("not-a-jwt", "x") == f"{HTTPS_ISSUER}end-session/"
