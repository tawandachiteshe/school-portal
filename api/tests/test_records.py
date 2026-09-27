from datetime import timedelta

import pytest
from sqlalchemy import update

from app.db import get_sessionmaker
from app.models import ModuleOffering
from app.services import clock
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
TARIRO = "TCFL/2027/0142"


async def _publish(when):
    async with get_sessionmaker()() as db:
        await db.execute(
            update(ModuleOffering)
            .where(ModuleOffering.class_group == "DIT-1A")
            .values(results_published_at=when)
        )
        await db.commit()


async def test_timetable_week():
    async with signed_in(TARIRO) as c:
        w = (await c.get("/student/timetable")).json()
        assert w["week"] == (7 if clock.today().weekday() >= 5 else 6) and w["class_group"] == "DIT-1A"
        assert [d["date"] for d in w["days"]][0] == w["starts_on"]
        assert len(w["days"]) == 5
        thursday = w["days"][3]["classes"]
        assert [x["module_code"] for x in thursday] == ["MTH110", "DCN201", "NET202", "PRG101"]
        nxt = (await c.get("/student/timetable", params={"start": w["days"][0]["date"][:10]})).json()
        assert nxt["starts_on"] == w["starts_on"]


async def test_timetable_notices_the_lab_closure():
    async with signed_in(TARIRO) as c:
        today = clock.today()
        friday = today + timedelta(days=(4 - today.weekday()) % 7 or 7)
        w = (await c.get("/student/timetable", params={"start": friday.isoformat()})).json()
    n = next(n for n in w["notices"])
    assert n["date"] == friday.isoformat()
    assert n["text"].endswith("None of your classes are affected.")


async def test_calendar_feed():
    async with signed_in(TARIRO) as c:
        r = await c.get("/student/timetable.ics")
    assert r.headers["content-type"].startswith("text/calendar")
    assert "BEGIN:VEVENT" in r.text and "SUMMARY:DCN201" in r.text and "LOCATION:Lab 3" in r.text


async def test_results_hidden_until_published_then_shown():
    async with signed_in(TARIRO) as c:
        r = (await c.get("/student/results")).json()
        assert r["current_published"] is False and r["terms"] == []
        await _publish(clock.now() - timedelta(days=1))
        try:
            r = (await c.get("/student/results")).json()
            t = r["terms"][0]
            assert r["current_published"] is True
            dcn = next(m for m in t["modules"] if m["module_code"] == "DCN201")
            assert (dcn["coursework_mark"], dcn["exam_mark"], dcn["final_mark"], dcn["is_pass"]) == (
                72,
                64,
                68,
                True,
            )
            assert t["remark_until"]
            slip = await c.get(f"/student/results/{t['term_code']}/slip.pdf")
            assert slip.content.startswith(b"%PDF")
            ok = await c.post(
                "/student/results/remarks",
                json={"offering_id": dcn["offering_id"], "reason": "Question 3 wasn't marked."},
            )
            assert ok.status_code == 201
            dup = await c.post(
                "/student/results/remarks",
                json={"offering_id": dcn["offering_id"], "reason": "Question 3 wasn't marked."},
            )
            assert dup.status_code == 409
            r = (await c.get("/student/results")).json()
            assert (
                next(m for m in r["terms"][0]["modules"] if m["module_code"] == "DCN201")["remark_status"]
                == "received"
            )
        finally:
            await _publish(None)


async def test_future_publication_stays_hidden():
    await _publish(clock.now() + timedelta(days=2))
    try:
        async with signed_in(TARIRO) as c:
            assert (await c.get("/student/results")).json()["terms"] == []
    finally:
        await _publish(None)


async def test_fees_statement():
    async with signed_in(TARIRO) as c:
        f = (await c.get("/student/fees")).json()
        assert f["balance"] == "310.00"
        assert f["next_payment"]["amount"] == "310.00" and f["next_payment"]["label"] == "Second instalment"
        assert f["payment_reference"] == TARIRO
        assert [x["receipt_ref"] for x in f["lines"]] == [None, "R-27-01934"]
        assert (await c.get("/student/fees/statement.pdf")).content.startswith(b"%PDF")


async def test_card():
    async with signed_in(TARIRO) as c:
        card = (await c.get("/student/card")).json()
    assert card["barcode"] == "TCFL20270142"
    assert card["valid_until"] == "2027-12-31"


def test_ics_escaping():
    from app.api.records import _ics_escape

    assert _ics_escape("Lab 3; Block C, room 2") == "Lab 3\; Block C\\, room 2"
