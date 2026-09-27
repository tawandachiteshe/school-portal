import pytest
from sqlalchemy import select

from app import storage
from app.api import apply_results
from app.db import get_sessionmaker
from app.models import Application, ApplicationFlag
from app.ocr.zimsec import SlipRead, SubjectRead, Word, parse
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
NEW = "263772345678"
SUBJECTS = {
    "1122": "English Language",
    "4004": "Mathematics",
    "2248": "Geography",
    "3159": "Shona",
    "4021": "Computer Science",
}


def _w(text, left, top, conf=0.95):
    return Word(text=text, conf=conf, left=left, top=top, width=20 * len(text), height=22, line=(1, 1, top))


def test_parse_rows_and_header():
    words = [
        _w("ORDINARY", 80, 180), _w("LEVEL", 260, 180), _w("NOVEMBER", 400, 180), _w("2022", 600, 180),
        _w("CENTRE", 80, 240), _w("NUMBER", 200, 240), _w("123456", 340, 240),
        _w("CANDIDATE", 520, 240), _w("NUMBER", 700, 240), _w("0457", 840, 240),
        _w("1122", 80, 400), _w("ENGLISH", 170, 400), _w("LANGUAGE", 310, 400), _w("B", 1000, 399),
        _w("4004", 80, 470), _w("MATHEMATICS", 170, 470), _w("C", 1000, 470, 0.7),
        # No code: matched by name. "8" is a misread B.
        _w("GEOGRAPHY", 170, 540), _w("8", 1000, 541),
        _w("SHONA", 170, 610), _w("€", 1000, 610, 0.69),
    ]  # fmt: skip
    r = parse(words, SUBJECTS, 1240, 1754)
    assert (r.level, r.session, r.year, r.centre_number, r.candidate_number) == (
        "O",
        "NOVEMBER",
        2022,
        "123456",
        "0457",
    )
    got = {s.name: (s.code, s.grade, s.read_as) for s in r.subjects}
    assert got["English Language"] == ("1122", "B", None)
    assert got["Mathematics"][1] == "C"
    assert got["Geography"] == ("2248", "B", "8")
    assert got["Shona"] == ("3159", None, "€")


def test_parse_certificate_layout():
    """ZIMSEC certificates: centre/candidate after the name, grades as "C (c)", marks after them,
    summary lines, and subjects missing from the reference table."""
    words = [
        _w("7", 200, 60, 0.1), _w("A", 240, 60, 0.1), _w("R", 280, 60, 0.1),
        _w("S", 320, 60, 0.1), _w("E", 360, 60, 0.1),
        _w("AT", 500, 520), _w("ORDINARY", 560, 520), _w("LEVEL", 760, 520),
        _w("the", 80, 580), _w("candidate", 140, 580), _w("named", 340, 580), _w("below", 460, 580),
        _w("MOYO", 200, 670), _w("TARIRO", 300, 670), _w("010655/3177", 1060, 670),
        _w("EXAMINATION", 500, 720), _w("OF", 740, 720), _w("NOVEMBER", 800, 720), _w("2019", 1000, 720),
        _w("MATHEMATICS", 290, 900), _w("C(c)", 1120, 900, 0.7), _w("=", 1180, 900),
        _w('"', 260, 930), _w("ENGLISH", 290, 930), _w("LANGUAGE", 430, 930),
        _w("B", 1120, 930), _w("(b)", 1150, 930), _w("I", 1200, 930),
        _w("INTEGRATED", 290, 960), _w("SCIENCE", 500, 960), _w("C", 1120, 960), _w("(c)", 1150, 960),
        _w("NUMBER", 290, 990), _w("OF", 420, 990), _w("SUBJECTS", 470, 990), _w("RECORDED", 640, 990),
        _w(":", 900, 990), _w("TWO", 1120, 990),
    ]  # fmt: skip
    r = parse(words, SUBJECTS, 2246, 3264)
    assert (r.level, r.session, r.year) == ("O", "NOVEMBER", 2019)
    assert (r.centre_number, r.candidate_number, r.candidate_name) == ("010655", "3177", "MOYO TARIRO")
    got = {s.name: (s.code, s.grade) for s in r.subjects}
    assert got == {
        "Mathematics": ("4004", "C"),
        "English Language": ("1122", "B"),
        "Integrated Science": (None, "C"),
    }
    unlisted = next(s for s in r.subjects if s.code is None)
    assert unlisted.confidence <= 0.6  # shown as "Check this grade"


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr(storage, "put", lambda bucket, key, data, ct: blobs.__setitem__(key, data))
    monkeypatch.setattr(storage, "get", lambda bucket, key: blobs[key])

    def read(data: bytes, mime: str, subjects) -> SlipRead:
        return SlipRead(
            level="O",
            session="NOVEMBER",
            year=2022,
            centre_number="654321",
            candidate_number="0911",
            candidate_name="CHIEDZA NYONI",
            subjects=[
                SubjectRead("1122", "English Language", "B", 0.96, {"x": 1000, "y": 400, "w": 16, "h": 22}),
                SubjectRead("4004", "Mathematics", "C", 0.96, None),
                SubjectRead("2248", "Geography", None, 0.5, {"x": 1000, "y": 680, "w": 16, "h": 22}, "€"),
                SubjectRead("3159", "Shona", "B", 0.95, None),
                SubjectRead("4021", "Computer Science", "A", 0.97, None),
            ],
            width=1240,
            height=1754,
        )

    monkeypatch.setattr(apply_results, "read_slip", read)


async def _start(c):
    progs = {p["code"]: p["id"] for p in (await c.get("/apply/programmes")).json()}
    await c.put("/apply/application/programme", json={"programme_id": progs["DIT"]})


async def test_photograph_read_check_and_save():
    async with signed_in(NEW) as c:
        await _start(c)
        s = (
            await c.post(
                "/apply/results/pages",
                files={"file": ("p1.jpg", b"page one", "image/jpeg")},
                data={"quality": "clear"},
            )
        ).json()
        scan = s["sittings"][-1]["key"]
        s = (
            await c.post(
                "/apply/results/pages",
                files={"file": ("p2.jpg", b"page two", "image/jpeg")},
                data={"scan": scan, "quality": "blurry"},
            )
        ).json()
        mine = next(x for x in s["sittings"] if x["key"] == scan)
        assert [p["quality"] for p in mine["pages"]] == ["clear", "blurry"] and mine["status"] == "pages"
        # Retake page 2.
        s = (await c.delete(f"/apply/results/pages/{mine['pages'][1]['document_id']}")).json()
        assert len(next(x for x in s["sittings"] if x["key"] == scan)["pages"]) == 1
        await c.post(f"/apply/results/scans/{scan}/read")
        s = (await c.get("/apply/results")).json()
        read = next(x for x in s["sittings"] if x["key"] == scan)
        assert read["status"] == "read" and read["centre_number"] == "654321"
        geo = next(x for x in read["subjects"] if x["name"] == "Geography")
        assert geo["check"] and geo["grade"] is None and geo["crop"]["page_w"] == 1240
        body = {
            "sittings": [
                {
                    "key": scan,
                    **{k: read[k] for k in ("level", "session", "year", "centre_number", "candidate_number")},
                    "subjects": [
                        {"code": x["code"], "name": x["name"], "grade": x["grade"] or "C"}
                        for x in read["subjects"]
                    ],
                }
            ]
        }
        bad = {"sittings": [{**body["sittings"][0], "subjects": [{"name": "Geography", "grade": "Q"}]}]}
        assert (await c.put("/apply/results", json=bad)).status_code == 422
        s = (await c.put("/apply/results", json=body)).json()
        saved = [x for x in s["sittings"] if x["status"] == "saved"]
        assert len(saved) == 1 and next(x for x in saved[0]["subjects"] if x["name"] == "Geography")["check"]
        a = (await c.get("/apply/application")).json()
        assert a["steps"]["results"]


async def test_same_candidate_elsewhere_is_flagged():
    async with signed_in(NEW) as c:
        await _start(c)
        body = {
            "sittings": [
                {
                    "level": "O", "session": "NOVEMBER", "year": 2022,
                    "centre_number": "123456", "candidate_number": "0457",
                    "subjects": [{"code": "1122", "name": "English Language", "grade": "B"}],
                }
            ]
        }  # fmt: skip
        assert (await c.put("/apply/results", json=body)).status_code == 200
        assert (await c.put("/apply/results", json={"sittings": body["sittings"] * 2})).status_code == 422
        ref = (await c.get("/apply/application")).json()["reference"]
    async with get_sessionmaker()() as db:
        codes = (
            (
                await db.execute(
                    select(ApplicationFlag.code).join(Application).where(Application.reference == ref)
                )
            )
            .scalars()
            .all()
        )
    assert "DUPLICATE_CANDIDATE" in codes  # Tariro is centre 123456, candidate 0457
    assert "NAME_MISMATCH" not in codes
