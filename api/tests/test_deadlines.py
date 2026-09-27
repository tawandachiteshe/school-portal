import hashlib

import pytest

from tests.helpers import signed_in
from tests.test_modules import storage_up

pytestmark = pytest.mark.anyio
TARIRO = "TCFL/2027/0142"


async def _item(c, title):
    items = (await c.get("/student/deadlines")).json()["items"]
    return next(i for i in items if i["title"] == title)


async def test_deadlines_list():
    async with signed_in(TARIRO) as c:
        d = (await c.get("/student/deadlines")).json()
    assert d["week"] == 6
    by = {i["title"]: i for i in d["items"]}
    assert by["Subnetting worksheet"]["status"] == "submitted"
    assert by["Lab sheet 4: Loops and arrays"]["accepted_extensions"] == [".c", ".pdf"]
    marked = by["Test 1: Limits and continuity"]
    assert (marked["mark"], marked["max_mark"]) == (29, 40)
    assert marked["feedback"].startswith("Good on limits")
    assert by["Assignment 2: Line coding"]["week"] == 10


async def test_cannot_submit_a_test_online():
    async with signed_in(TARIRO) as c:
        t = await _item(c, "Test 2: Differentiation")
        a = (await c.get(f"/student/assessments/{t['id']}")).json()
        assert a["can_submit"] is False
        r = await c.post(
            f"/student/assessments/{t['id']}/uploads", json={"filename": "x.pdf", "size_bytes": 10}
        )
        assert r.status_code == 409


async def test_file_type_and_size_are_checked():
    async with signed_in(TARIRO) as c:
        lab = await _item(c, "Lab sheet 4: Loops and arrays")
        r = await c.post(
            f"/student/assessments/{lab['id']}/uploads", json={"filename": "lab.docx", "size_bytes": 10}
        )
        assert r.status_code == 422 and ".c or .pdf" in r.json()["detail"]
        r = await c.post(
            f"/student/assessments/{lab['id']}/uploads",
            json={"filename": "lab.pdf", "size_bytes": 11_000_000},
        )
        assert r.status_code == 422 and "10 MB" in r.json()["detail"]


@pytest.mark.skipif(not storage_up(), reason="object storage not running")
async def test_resumable_upload_and_receipt():
    data = bytes(range(256)) * 2500  # 640,000 bytes: three chunks
    async with signed_in(TARIRO) as c:
        lab = await _item(c, "Lab sheet 4: Loops and arrays")
        up = (
            await c.post(
                f"/student/assessments/{lab['id']}/uploads",
                json={
                    "filename": "lab4_tariro_moyo.pdf",
                    "size_bytes": len(data),
                    "mime_type": "application/pdf",
                },
            )
        ).json()
        chunk = up["chunk_bytes"]
        # First chunk arrives.
        r = await c.put(f"/student/uploads/{up['id']}?offset=0", content=data[:chunk])
        assert r.json()["received_bytes"] == chunk
        # A retried chunk at the wrong offset is refused with the place to resume from.
        r = await c.put(f"/student/uploads/{up['id']}?offset=0", content=data[:chunk])
        assert r.status_code == 409 and r.json()["detail"]["received_bytes"] == chunk
        # The assessment page shows the unfinished upload, for resuming after a drop.
        a = (await c.get(f"/student/assessments/{lab['id']}")).json()
        assert a["pending_upload"]["received_bytes"] == chunk
        # Can't complete early.
        assert (await c.post(f"/student/uploads/{up['id']}/complete", json={})).status_code == 409
        offset = chunk
        while offset < len(data):
            r = await c.put(
                f"/student/uploads/{up['id']}?offset={offset}", content=data[offset : offset + chunk]
            )
            offset = r.json()["received_bytes"]
        receipt = (
            await c.post(f"/student/uploads/{up['id']}/complete", json={"note": "Exercise 6 is partly done."})
        ).json()
        assert receipt["status"] == "submitted"
        assert receipt["note"] == "Exercise 6 is partly done."
        assert receipt["files"][0]["sha256"] == hashlib.sha256(data).hexdigest()
        assert receipt["files"][0]["filename"] == "lab4_tariro_moyo.pdf"
        assert (await _item(c, "Lab sheet 4: Loops and arrays"))["status"] == "submitted"
        a = (await c.get(f"/student/assessments/{lab['id']}")).json()
        assert a["pending_upload"] is None and a["submission"]["files"][0]["size_bytes"] == len(data)


async def test_uploads_belong_to_their_student():
    async with signed_in(TARIRO) as c:
        lab = await _item(c, "Lab sheet 5: Functions")
        up = (
            await c.post(
                f"/student/assessments/{lab['id']}/uploads", json={"filename": "f.c", "size_bytes": 5}
            )
        ).json()
        assert (await c.delete(f"/student/uploads/{up['id']}")).status_code == 204
        assert (await c.get(f"/student/uploads/{up['id']}")).status_code == 404
