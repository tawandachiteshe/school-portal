import pytest

from app import storage
from app.config import get_settings
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
TARIRO = "TCFL/2027/0142"


def storage_up() -> bool:
    try:
        storage.client().head_bucket(Bucket=get_settings().s3_bucket_content)
        return True
    except Exception:
        return False


async def test_module_list():
    async with signed_in(TARIRO) as c:
        d = (await c.get("/student/modules")).json()
    assert d["term_name"] == "Semester 1 2027"
    assert d["class_group"] == "DIT-1A"
    mods = {m["code"]: m for m in d["modules"]}
    assert set(mods) == {"DCN201", "NET202", "PRG101", "MTH110"}
    assert mods["DCN201"]["lecturer"] == "Eng. F. Chikore"
    assert all(m["next_class"] for m in d["modules"])  # everything meets weekly
    starts = [m["next_class"]["starts_at"] for m in d["modules"]]
    assert starts == sorted(starts)
    assert mods["DCN201"]["new_notes"] == 1  # "Amplitude and frequency modulation", this week


async def test_module_detail():
    async with signed_in(TARIRO) as c:
        d = (await c.get("/student/modules/dcn201")).json()
    assert d["name"] == "Data Communications"
    assert d["lecturer"]["name"] == "Eng. F. Chikore"
    assert d["lecturer"]["consultation_hours"] == "Tuesdays 14:00–16:00"
    assert (d["coursework_weight"], d["exam_weight"]) == (50, 50)
    assert d["week"] in (6, 7)  # week 7 once this week's classes are over
    assert len(d["week_classes"]) == 2  # Mon, Thu
    a1 = next(a for a in d["assessments"] if a["title"] == "Assignment 1: Signal types")
    assert (a1["mark"], a1["max_mark"], a1["status"]) == (16, 20, "marked")
    t1 = next(a for a in d["assessments"] if a["title"].startswith("Test 1"))
    assert t1["mark"] is None and t1["status"] is None
    assert d["exam_scheduled"] is False
    assert len(d["notes"]) == 9


async def test_module_not_taken_is_404():
    async with signed_in(TARIRO) as c:
        assert (await c.get("/student/modules/XYZ999")).status_code == 404


@pytest.mark.skipif(not storage_up(), reason="object storage not running")
async def test_download_streams_the_file_and_marks_it_downloaded():
    async with signed_in(TARIRO) as c:
        note = (await c.get("/student/modules/DCN201")).json()["notes"][0]
        assert note["downloaded"] is False
        r = await c.get(f"/student/materials/{note['id']}/download")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/pdf"
        assert "DCN201" in r.headers["content-disposition"]
        assert r.content.startswith(b"%PDF") and len(r.content) == note["size_bytes"]
        again = (await c.get("/student/modules/DCN201")).json()["notes"][0]
        assert again["downloaded"] is True
        mods = {m["code"]: m for m in (await c.get("/student/modules")).json()["modules"]}
        assert mods["DCN201"]["new_notes"] == 0


async def test_cannot_download_another_programmes_notes():
    async with signed_in(TARIRO) as c:
        note = (await c.get("/student/modules/DCN201")).json()["notes"][0]
    async with signed_in("fchikore") as c:  # staff aren't students
        assert (await c.get(f"/student/materials/{note['id']}/download")).status_code == 403
