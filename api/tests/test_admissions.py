import pytest

from app.services import eligibility
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
OFFICER = "cmarufu"
RULES = {
    "min_passes": 5,
    "min_grade": "C",
    "level": "O",
    "required_subjects": ["English Language", "Mathematics"],
}


def test_eligibility_explains_what_is_missing():
    meets = {
        "English Language": "B",
        "Mathematics": "C",
        "Geography": "C",
        "History": "B",
        "Shona": "A",
        "Biology": "B",
    }
    assert eligibility.evaluate(RULES, meets).summary == "Meets"
    assert eligibility.evaluate(RULES, {**meets, "Mathematics": "D"}).summary == "Maths below C"
    four = {**meets, "Shona": "E", "Biology": "U"}
    assert eligibility.evaluate(RULES, four).summary == "4 passes, needs 5"
    no_english = {k: v for k, v in meets.items() if k != "English Language"}
    assert eligibility.evaluate(RULES, no_english).summary == "No English"


def test_resit_improves_a_grade():
    best = eligibility.best_grades([[("Mathematics", "D")], [("Mathematics", "C")]])
    assert best == {"Mathematics": "C"}


def test_unclear_grades_matter_only_if_a_one_grade_misread_flips_the_result():
    six = {
        "English Language": "B",
        "Mathematics": "C",
        "Physical Science": "B",
        "Geography": "C",
        "Shona": "B",
        "Computer Science": "A",
    }
    assert not eligibility.unclear_decides(RULES, six, {"Physical Science", "Geography"})
    five = {k: v for k, v in six.items() if k != "Shona"}
    assert eligibility.unclear_decides(RULES, five, {"Geography"})


async def test_only_admissions():
    async with signed_in("fchikore") as c:
        assert (await c.get("/staff/admissions/applications")).status_code == 403


async def test_queue_tabs_and_rows():
    async with signed_in(OFFICER) as c:
        s = (await c.get("/staff/admissions/summary")).json()
        assert (
            s["intake"] == "2027 intake" and s["open"] == s["to_review"] + s["needs_checking"] + s["waiting"]
        )
        rows = (await c.get("/staff/admissions/applications")).json()
        by = {r["reference"]: r for r in rows}
        assert by["APP-27-08772"]["eligibility"] == "Maths below C" and not by["APP-27-08772"]["eligible"]
        assert by["APP-27-08877"]["eligibility"] == "4 passes, needs 5"
        assert by["APP-27-08852"]["eligibility"] == "Meets"  # the June resit brings Maths to C
        assert by["APP-27-08813"]["attention"] == "2 grades confirmed by applicant"
        assert by["APP-27-08813"]["national_id"] == "63-2047823 C 29" and by["APP-27-08813"]["owner_is_me"]
        # Oldest first.
        assert rows[0]["reference"] == "APP-27-08772"
        checking = (await c.get("/staff/admissions/applications", params={"tab": "needs_checking"})).json()
        assert {r["reference"] for r in checking} == {"APP-27-08885", "APP-27-08829"}
        csv = await c.get("/staff/admissions/applications.csv")
        assert csv.status_code == 200 and "APP-27-08813,Tariro Moyo" in csv.text


async def test_review_page():
    async with signed_in(OFFICER) as c:
        r = (await c.get("/staff/admissions/applications/APP-27-08813")).json()
    assert r["status"] == "in_review" and r["assigned_to_me"]
    assert r["nav"]["previous"] == "APP-27-08790" and r["nav"]["next"] == "APP-27-08821"
    assert [x["met"] for x in r["eligibility"]["rows"]] == [True, True, True]
    assert r["unclear_count"] == 2 and not r["unclear_decides"]
    ident = r["identity"]
    assert ident["check_letter_valid"] and ident["names_match"]
    assert (ident["registered_in"], ident["origin"]) == ("Harare", "Gweru")
    assert [x["read"] for x in r["sittings"][0]["rows"]].count("unclear_confirmed") == 2
    assert r["activity"][-1]["text"] == "Application started"


async def test_opening_takes_the_application_then_decide():
    async with signed_in(OFFICER) as c:
        r = (await c.post("/staff/admissions/applications/APP-27-08821/assign")).json()
        assert r["status"] == "in_review" and r["assigned_to_me"]
        assert r["activity"][0]["text"] == "Review started"
        r = (await c.post("/staff/admissions/applications/APP-27-08821/identity-checked")).json()
        assert r["identity"]["checked_by"] == "C. Marufu"
        sid = r["sittings"][0]["id"]
        r = (await c.post(f"/staff/admissions/applications/APP-27-08821/sittings/{sid}/verified")).json()
        assert r["sittings"][0]["verification"] == "verified"
        r = (
            await c.post(
                "/staff/admissions/applications/APP-27-08821/notes", json={"text": "Called about start date."}
            )
        ).json()
        assert r["activity"][0]["note"] and r["activity"][0]["by"] == "C. Marufu"
        bad = await c.post(
            "/staff/admissions/applications/APP-27-08821/decision", json={"decision": "decline"}
        )
        assert bad.status_code == 422
        r = (
            await c.post("/staff/admissions/applications/APP-27-08821/decision", json={"decision": "offer"})
        ).json()
        assert r["status"] == "accepted" and r["decided_by"] == "C. Marufu" and r["nav"]["tab"] == "decided"
        again = await c.post(
            "/staff/admissions/applications/APP-27-08821/decision", json={"decision": "offer"}
        )
        assert again.status_code == 409


async def test_resolving_a_check_moves_it_back_to_review():
    async with signed_in(OFFICER) as c:
        r = (await c.get("/staff/admissions/applications/APP-27-08885")).json()
        assert r["nav"]["tab"] == "needs_checking" and r["flags"][0]["severity"] == "high"
        r = (
            await c.post(
                f"/staff/admissions/applications/APP-27-08885/flags/{r['flags'][0]['id']}/resolve",
                json={"resolution": "Applicant sent a photo of the ID; the number was misread."},
            )
        ).json()
        assert r["flags"] == [] and r["nav"]["tab"] == "to_review"


async def test_ask_for_information_and_sms():
    async with signed_in(OFFICER) as c:
        r = (
            await c.post(
                "/staff/admissions/applications/APP-27-08861/decision",
                json={"decision": "ask", "message": "Please upload your birth certificate."},
            )
        ).json()
        assert r["status"] == "more_info" and r["nav"]["tab"] == "waiting"
        # Tariro has a phone; seeded applicants don't.
        assert (
            await c.post("/staff/admissions/applications/APP-27-08861/message", json={"text": "Hi"})
        ).status_code == 409
        sent = await c.post(
            "/staff/admissions/applications/APP-27-08813/message", json={"text": "Please call us."}
        )
        assert sent.json()["sms_queued"] is True


async def test_document_file():
    async with signed_in(OFFICER) as c:
        r = (await c.get("/staff/admissions/applications/APP-27-08813")).json()
        f = await c.get(f"/staff/admissions/documents/{r['identity']['document_id']}/file")
    assert f.status_code in (200, 404)  # 404 when object storage isn't running
    if f.status_code == 200:
        assert f.headers["content-type"].startswith("image/svg+xml")
