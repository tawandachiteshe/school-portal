from datetime import timedelta

import pytest
from sqlalchemy import select

from app.db import get_sessionmaker
from app.models import Enrolment, Student
from app.services import clock, timetable
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
TARIRO = "TCFL/2027/0142"


async def test_dashboard_lists_the_next_seven_days():
    async with signed_in(TARIRO) as c:
        d = (await c.get("/student/dashboard")).json()
    titles = [x["title"] for x in d["due"]]
    assert "Test 1: Signals and modulation" in titles
    assert "Lab sheet 4: Loops and arrays" in titles
    assert "Assignment 2: Line coding" not in titles  # four weeks away
    assert next(x for x in d["due"] if x["title"] == "Subnetting worksheet")["submitted"] is True
    assert [x["due_at"] for x in d["due"]] == sorted(x["due_at"] for x in d["due"])


async def test_dashboard_announcements_pinned_first_with_unread_count():
    async with signed_in(TARIRO) as c:
        a = (await c.get("/student/dashboard")).json()["announcements"]
    assert a["total"] == 5
    assert len(a["items"]) == 3
    assert a["items"][0]["is_pinned"] and a["items"][0]["from_label"] == "Accounts Office"
    assert a["unread"] == 3


async def test_dashboard_loans_and_results():
    async with signed_in(TARIRO) as c:
        d = (await c.get("/student/dashboard")).json()
    loans = {x["title"]: x for x in d["loans"]}
    assert loans["Engineering Mathematics"]["overdue"] is True
    assert loans["Data Communications and Networking"]["renewals_left"] == 1
    assert d["results"] == {"term_name": "Semester 1 2027", "published": False}
    assert [n["title"] for n in d["notes"]][0] == "Amplitude and frequency modulation"


async def test_staff_cannot_open_the_student_dashboard():
    async with signed_in("fchikore") as c:
        assert (await c.get("/student/dashboard")).status_code == 403


async def test_thursday_timetable_matches_the_design():
    today = clock.today()
    thursday = today + timedelta(days=(3 - today.weekday()) % 7)
    async with get_sessionmaker()() as db:
        st = (await db.execute(select(Student).where(Student.student_number == TARIRO))).scalar_one()
        ids = list(
            (await db.execute(select(Enrolment.offering_id).where(Enrolment.student_id == st.id))).scalars()
        )
        day = await timetable.occurrences(db, ids, [thursday])
    assert [(o.starts_at.strftime("%H:%M"), o.module_code, o.venue) for o in day] == [
        ("08:00", "MTH110", "Lecture Room B2"),
        ("10:00", "DCN201", "Lab 3"),
        ("12:00", "NET202", "Lab 3"),
        ("14:30", "PRG101", "Block C"),
    ]
    assert day[1].lecturer == "Eng. F. Chikore"


async def test_announcement_detail_says_whether_it_affects_you_and_marks_read():
    async with signed_in(TARIRO) as c:
        items = (await c.get("/student/announcements")).json()["items"]
        lab = next(i for i in items if i["title"].startswith("Lab 3 closed"))
        assert lab["read"] is False
        d = (await c.get(f"/student/announcements/{lab['id']}")).json()
        assert d["audience"] == "all students and staff"
        assert d["affects_you"] is False
        assert d["affects"].startswith("None of your classes are in Lab 3")
        assert d["contact_line"] == "Questions: ICT Services, Block C"
        after = (await c.get("/student/announcements")).json()["items"]
        assert next(i for i in after if i["id"] == lab["id"])["read"] is True


async def test_year_one_audience_is_described():
    async with signed_in(TARIRO) as c:
        items = (await c.get("/student/announcements")).json()["items"]
        brief = next(i for i in items if i["title"].startswith("Industrial attachment"))
        d = (await c.get(f"/student/announcements/{brief['id']}")).json()
    assert d["audience"] == "Year 1 · all programmes"


async def test_renewing_loans():
    async with signed_in(TARIRO) as c:
        loans = {x["title"]: x for x in (await c.get("/student/dashboard")).json()["loans"]}
        overdue = await c.post(f"/library/loans/{loans['Engineering Mathematics']['id']}/renew")
        assert overdue.status_code == 409
        assert "can't be renewed online" in overdue.json()["detail"]
        ok = await c.post(f"/library/loans/{loans['Data Communications and Networking']['id']}/renew")
        assert ok.status_code == 200 and ok.json()["renewals_left"] == 0
        again = await c.post(f"/library/loans/{loans['Data Communications and Networking']['id']}/renew")
        assert again.status_code == 409


async def test_cannot_renew_someone_elses_loan():
    async with signed_in(TARIRO) as c:
        loan_id = (await c.get("/student/dashboard")).json()["loans"][0]["id"]
    async with signed_in("fchikore") as c:
        assert (await c.post(f"/library/loans/{loan_id}/renew")).status_code == 403


async def test_search_finds_modules_notes_and_announcements():
    async with signed_in(TARIRO) as c:
        r = (await c.get("/student/search", params={"q": "modulation"})).json()
        assert "Amplitude and frequency modulation" in [n["title"] for n in r["notes"]]
        r = (await c.get("/student/search", params={"q": "networks"})).json()
        assert [m["code"] for m in r["modules"]] == ["NET202"]
        r = (await c.get("/student/search", params={"q": "lab 3"})).json()
        assert any(a["title"].startswith("Lab 3 closed") for a in r["announcements"])
