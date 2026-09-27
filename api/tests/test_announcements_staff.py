from datetime import timedelta

import pytest
from sqlalchemy import delete, func, select

from app.db import get_sessionmaker
from app.models import Announcement, Notification, NotificationDelivery, User
from app.services import announcements, clock
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
AFFAIRS = "tmushonga"
TARIRO = "TCFL/2027/0142"


@pytest.fixture(scope="module")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="module", autouse=True)
async def remove_what_these_tests_publish():
    """Other test modules count the seeded announcements."""
    async with get_sessionmaker()() as db:
        seeded = set((await db.execute(select(Announcement.id))).scalars())
    yield
    async with get_sessionmaker()() as db:
        added = list(
            (await db.execute(select(Announcement.id).where(Announcement.id.not_in(seeded)))).scalars()
        )
        keys = [f"announcement:{i}" for i in added]
        await db.execute(delete(Notification).where(Notification.dedupe_key.in_(keys)))
        await db.execute(delete(Announcement).where(Announcement.id.in_(added)))
        await db.commit()


def draft(**kw) -> dict:
    return {
        "title": "Industrial attachment briefing for Year 1: Tuesday, 14:00, Lecture Room B2",
        "body": "All Year 1 students must attend. Bring a pen and your student card.",
        "audience": {"kind": "groups", "groups": [{"programme_id": None, "year": 1}]},
        "pinned": False,
        "sms_text": None,
        "action": "draft",
        **kw,
    }


async def _student_titles(username: str) -> list[str]:
    async with signed_in(username) as c:
        return [i["title"] for i in (await c.get("/student/announcements")).json()["items"]]


async def test_staff_see_the_list_but_only_student_affairs_write():
    async with signed_in("fchikore") as c:
        assert (await c.get("/staff/announcements")).status_code == 200
        assert (await c.post("/staff/announcements", json=draft())).status_code == 403
    async with signed_in(TARIRO) as c:
        assert (await c.get("/staff/announcements")).status_code == 403


async def test_options_and_reach():
    async with signed_in(AFFAIRS) as c:
        o = (await c.get("/staff/announcements/options")).json()
        assert o["from_label"] == "Student Affairs" and o["sms_max"] == 160
        assert any(p["name"] == "Diploma in Information Technology" for p in o["programmes"])
        year1 = (await c.post("/staff/announcements/reach", json=draft()["audience"])).json()
        everyone = (await c.post("/staff/announcements/reach", json={"kind": "everyone"})).json()
        year2 = (
            await c.post("/staff/announcements/reach", json={"kind": "groups", "groups": [{"year": 2}]})
        ).json()
    assert year1["students"] > 0 and year1["staff"] == 0
    assert everyone["staff"] > 0 and everyone["students"] >= year1["students"] + year2["students"]


async def test_draft_is_hidden_until_published_then_notifies_the_audience():
    async with signed_in(AFFAIRS) as c:
        d = (
            await c.post("/staff/announcements", json=draft(sms_text="TCFL: Year 1 briefing Tue 14:00, B2."))
        ).json()
        assert d["status"] == "draft" and d["audience"]["groups"] == [{"programme_id": None, "year": 1}]
    assert draft()["title"] not in await _student_titles(TARIRO)

    async with signed_in(AFFAIRS) as c:
        p = await c.put(
            f"/staff/announcements/{d['id']}", json=draft(action="publish", sms_text="TCFL: Year 1.")
        )
        assert p.status_code == 200 and p.json()["status"] == "published"
        listed = next(a for a in (await c.get("/staff/announcements")).json() if a["id"] == d["id"])
        assert listed["audience"] == "Year 1 · all programmes" and listed["sms"]
        # Once published it can't be deleted.
        assert (await c.delete(f"/staff/announcements/{d['id']}")).status_code == 409
    assert draft()["title"] in await _student_titles(TARIRO)

    async with get_sessionmaker()() as db:
        tariro = (await db.execute(select(User).where(User.username == TARIRO))).scalar_one()
        n = (
            (
                await db.execute(
                    select(Notification).where(Notification.dedupe_key == f"announcement:{d['id']}")
                )
            )
            .scalars()
            .all()
        )
        assert tariro.id in {x.user_id for x in n}
        sms = await db.scalar(
            select(func.count())
            .select_from(NotificationDelivery)
            .join(Notification)
            .where(
                Notification.dedupe_key == f"announcement:{d['id']}", NotificationDelivery.channel == "sms"
            )
        )
        assert sms >= 1  # Tariro has a phone
        # Dispatching again does nothing.
        assert await announcements.dispatch_due(db) == 0


async def test_other_years_do_not_see_it():
    body = draft(
        title="Year 2 attachment placements list is up",
        audience={"kind": "groups", "groups": [{"year": 2}]},
        action="publish",
    )
    async with signed_in(AFFAIRS) as c:
        assert (await c.post("/staff/announcements", json=body)).status_code == 200
    assert body["title"] not in await _student_titles(TARIRO)


async def test_scheduled_waits_for_its_time():
    at = (clock.now() + timedelta(days=2)).isoformat()
    body = draft(
        title="Graduation rehearsal", action="schedule", publish_at=at, audience={"kind": "students"}
    )
    async with signed_in(AFFAIRS) as c:
        r = (await c.post("/staff/announcements", json=body)).json()
        assert r["status"] == "scheduled"
    assert "Graduation rehearsal" not in await _student_titles(TARIRO)
    async with get_sessionmaker()() as db:
        assert await announcements.dispatch_due(db) == 0
    async with signed_in(AFFAIRS) as c:
        assert (await c.delete(f"/staff/announcements/{r['id']}")).status_code == 200


async def test_publishing_needs_the_basics():
    async with signed_in(AFFAIRS) as c:
        assert (
            await c.post("/staff/announcements", json=draft(title=" ", action="publish"))
        ).status_code == 422
        r = await c.post("/staff/announcements", json=draft(sms_text="x" * 161, action="publish"))
        assert r.status_code == 422
        r = await c.post(
            "/staff/announcements", json=draft(audience={"kind": "groups", "groups": []}, action="publish")
        )
        assert r.status_code == 422
        # Drafts may be incomplete.
        assert (await c.post("/staff/announcements", json=draft(title="", action="draft"))).status_code == 200


async def test_pin_ends():
    past = (clock.now() - timedelta(minutes=1)).isoformat()
    async with signed_in(AFFAIRS) as c:
        r = await c.post(
            "/staff/announcements",
            json=draft(pinned=True, pinned_until=past, action="publish", title="Old pin"),
        )
        assert r.status_code == 422
