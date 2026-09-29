from datetime import date

import pytest

from app.api.apply import add_working_days, entry_text
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
NEW = "263772345678"  # Chiedza Nyoni, nothing started
TARIRO = "CC/2027/0142"


def test_entry_text():
    rules = {
        "min_passes": 5,
        "min_grade": "C",
        "required_subjects": ["English Language", "Mathematics", "Physical Science"],
    }
    assert (
        entry_text(rules)
        == "5 O-Levels at C or better, including English Language, Mathematics and Physical Science"
    )


def test_decision_expected_after_working_days():
    # design/Status: submitted Mon 12 October 2026, decision expected by Fri 30 October.
    assert add_working_days(date(2026, 10, 12), 14) == date(2026, 10, 30)


async def test_only_applicants():
    async with signed_in("cmarufu") as c:
        assert (await c.get("/apply/programmes")).status_code == 403


async def test_programmes_show_award_length_and_entry():
    async with signed_in(NEW) as c:
        rows = (await c.get("/apply/programmes")).json()
    dit = next(p for p in rows if p["code"] == "DIT")
    assert dit["award"] == "HEXCO National Diploma" and dit["length"] == "3 years"
    assert dit["entry"] == "5 O-Levels at C or better, including English Language and Mathematics"
    assert rows[-1]["code"] == "CCN"  # diplomas first, then the certificate


async def test_choosing_a_programme_starts_the_application():
    async with signed_in(NEW) as c:
        assert (await c.get("/apply/application")).json() is None
        progs = {p["code"]: p["id"] for p in (await c.get("/apply/programmes")).json()}
        a = (await c.put("/apply/application/programme", json={"programme_id": progs["DSE"]})).json()
        assert a["status"] == "draft" and a["reference"].startswith("APP-27-")
        assert a["next_step"] == "national_id" and a["steps"]["programme"]
        # Changing it keeps the same application.
        b = (await c.put("/apply/application/programme", json={"programme_id": progs["DIT"]})).json()
        assert b["reference"] == a["reference"] and b["programme"] == "Diploma in Information Technology"


async def test_status_of_a_submitted_application():
    async with signed_in(TARIRO) as c:
        a = (await c.get("/apply/application")).json()
        assert a["reference"] == "APP-27-08813" and a["status"] == "in_review"
        assert a["review_started_at"] and a["decision_expected_by"]
        assert a["phone_masked"] == "+263 77 ••• 4521"
        progs = {p["code"]: p["id"] for p in (await c.get("/apply/programmes")).json()}
        r = await c.put("/apply/application/programme", json={"programme_id": progs["DSE"]})
        assert r.status_code == 409


async def test_offer_accept():
    # Admissions offers Tariro a place, then she answers it.
    async with signed_in("cmarufu") as c:
        r = await c.post("/staff/admissions/applications/APP-27-08813/decision", json={"decision": "offer"})
        assert r.status_code == 200
    async with signed_in(TARIRO) as c:
        a = (await c.get("/apply/application")).json()
        assert a["status"] == "accepted" and a["offer"]["registration_place"] == "Block A"
        letter = await c.get("/apply/offer/letter.pdf")
        assert letter.status_code == 200 and letter.content.startswith(b"%PDF")
        a = (await c.post("/apply/offer", json={"answer": "accept"})).json()
        assert a["offer"]["accepted_at"]
        assert (await c.post("/apply/offer", json={"answer": "decline"})).status_code == 409


async def test_withdraw():
    async with signed_in(NEW) as c:
        a = (await c.post("/apply/application/withdraw")).json()
        assert a["status"] == "withdrawn"
        assert (await c.get("/apply/application")).json() is None
