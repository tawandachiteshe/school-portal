import pytest

from app import storage
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
NEW = "263772345678"


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch):
    monkeypatch.setattr(storage, "put", lambda *a: None)


def sitting(maths: str, year: int = 2022, session: str = "NOVEMBER") -> dict:
    return {
        "level": "O",
        "session": session,
        "year": year,
        "centre_number": "654321",
        "candidate_number": "0911",
        "subjects": [
            {"code": "1122", "name": "English Language", "grade": "B"},
            {"code": "4004", "name": "Mathematics", "grade": maths},
            {"code": "5009", "name": "Physical Science", "grade": "B"},
            {"code": "4021", "name": "Computer Science", "grade": "A"},
            {"code": "2248", "name": "Geography", "grade": "C"},
            {"code": "3159", "name": "Shona", "grade": "B"},
        ],
    }


async def _ready(c):
    progs = {p["code"]: p["id"] for p in (await c.get("/apply/programmes")).json()}
    await c.put("/apply/application/programme", json={"programme_id": progs["DIT"]})
    person = {"surname": "NYONI", "first_names": "CHIEDZA", "date_of_birth": "2006-05-14"}
    await c.put("/apply/national-id", json={"id_number": "08-2047823 Q 29", **person})
    await c.post("/apply/birth-certificate", files={"file": ("bc.jpg", b"x", "image/jpeg")})
    await c.put("/apply/birth-certificate", json={"name": "CHIEDZA NYONI", "date_of_birth": "2006-05-14"})


async def test_review_lists_what_is_missing():
    async with signed_in(NEW) as c:
        progs = {p["code"]: p["id"] for p in (await c.get("/apply/programmes")).json()}
        await c.put("/apply/application/programme", json={"programme_id": progs["DIT"]})
        await c.post("/apply/application/withdraw")  # start clean
        await c.put("/apply/application/programme", json={"programme_id": progs["DIT"]})
        r = (await c.get("/apply/review")).json()
    # The ID stays on the person from earlier tests; a new application needs the rest again.
    assert {"birth_certificate", "results"} <= set(r["missing"]) and r["eligibility"] is None


async def test_not_eligible_explains_the_grade_and_the_sitting():
    async with signed_in(NEW) as c:
        await _ready(c)
        await c.put("/apply/results", json={"sittings": [sitting("D")]})
        r = (await c.get("/apply/review")).json()
    e = r["eligibility"]
    assert not e["eligible"] and r["missing"] == []
    assert e["shortfalls"][0] == {
        "need": "It needs Mathematics at grade C or better.",
        "have": "Your results show Mathematics D (O-Level, November 2022).",
        "subject": "Mathematics",
    }
    assert e["other_passes"] == [
        "English Language B",
        "Physical Science B",
        "Computer Science A",
        "Geography C",
        "Shona B",
    ]
    assert r["birth_certificate"]["matches_id"] and r["national_id"]["registered_in"] == "Bulawayo"


async def test_a_resit_makes_it_eligible():
    async with signed_in(NEW) as c:
        await _ready(c)
        await c.put("/apply/results", json={"sittings": [sitting("D"), sitting("C", 2023, "JUNE")]})
        r = (await c.get("/apply/review")).json()
    e = r["eligibility"]
    assert (
        e["eligible"]
        and e["summary"] == "6 passes at C or better, including English Language and Mathematics."
    )
    assert [s["label"] for s in r["sittings"]] == ["O-Level, November 2022", "O-Level, June 2023"]
