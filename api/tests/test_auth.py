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
    assert me["roles"] == ["student"]
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
