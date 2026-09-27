from datetime import timedelta

import pytest
from sqlalchemy import select

from app.db import get_sessionmaker
from app.models import ModuleOffering, TimetableSlot
from app.services import clock
from tests.helpers import signed_in
from tests.test_modules import storage_up

pytestmark = pytest.mark.anyio
LECTURER = "fchikore"


async def test_overview_matches_the_design():
    async with signed_in(LECTURER) as c:
        o = (await c.get("/staff/teaching/overview")).json()
    assert o["greeting_name"] == "Eng. Chikore"
    assert [(x["module_code"], x["class_group"], x["students"]) for x in o["classes"]] == [
        ("DCN201", "DIT-1A", 38),
        ("DCN201", "DTE-1A", 41),
    ]
    dte = next(m for m in o["marking"] if m["class_group"] == "DTE-1A")
    assert (dte["title"], dte["marked"], dte["students"]) == ("Assignment 1: Signal types", 35, 41)
    notes = {n["title"]: n for n in o["notes"]}
    amp = notes["Amplitude and frequency modulation"]
    # 24 in the seed (design), plus any downloads earlier tests made.
    assert amp["downloaded"] >= 24 and (amp["audience"], amp["class_groups"]) == (79, ["DIT-1A", "DTE-1A"])


async def test_students_cannot_use_the_lecturer_api():
    async with signed_in("TCFL/2027/0142") as c:
        assert (await c.get("/staff/teaching/overview")).status_code == 403


async def test_another_lecturer_cannot_see_the_class():
    async with signed_in(LECTURER) as c:
        oid = (await c.get("/staff/teaching/overview")).json()["classes"][0]["offering_id"]
    async with signed_in("sncube") as c:
        assert (await c.get(f"/staff/teaching/classes/{oid}")).status_code == 404


async def test_marks_draft_validation_and_publish():
    async with signed_in(LECTURER) as c:
        o = (await c.get("/staff/teaching/overview")).json()
        aid = next(m for m in o["marking"] if m["class_group"] == "DTE-1A")["assessment_id"]
        sheet = (await c.get(f"/staff/teaching/assessments/{aid}/marks")).json()
        assert sheet["max_mark"] == 20 and len(sheet["rows"]) == 41
        assert sheet["rows"] == sorted(sheet["rows"], key=lambda r: r["name"])
        empty = [r for r in sheet["rows"] if r["mark"] is None]
        assert len(empty) == 6
        # Over the maximum is refused.
        bad = await c.put(
            f"/staff/teaching/assessments/{aid}/marks",
            json={"rows": [{"student_id": empty[0]["student_id"], "mark": 21}]},
        )
        assert bad.status_code == 422
        # Can't publish with marks missing.
        assert (await c.post(f"/staff/teaching/assessments/{aid}/publish")).status_code == 409
        rows = [{"student_id": r["student_id"], "mark": 14} for r in empty[:5]]
        rows.append(
            {"student_id": empty[5]["student_id"], "is_absent": True, "absence_note": "Medical note received"}
        )
        saved = (await c.put(f"/staff/teaching/assessments/{aid}/marks", json={"rows": rows})).json()
        absent = next(r for r in saved["rows"] if r["student_id"] == empty[5]["student_id"])
        assert (
            absent["is_absent"]
            and absent["mark"] is None
            and absent["absence_note"] == "Medical note received"
        )
        published = (await c.post(f"/staff/teaching/assessments/{aid}/publish")).json()
        assert published["released_at"]


@pytest.mark.skipif(not storage_up(), reason="object storage not running")
async def test_upload_notes_to_two_classes():
    async with signed_in(LECTURER) as c:
        classes = (await c.get("/staff/teaching/overview")).json()["classes"]
        r = await c.post(
            "/staff/teaching/materials",
            data={
                "title": "Multiplexing, part 1",
                "week": "7",
                "offering_ids": [x["offering_id"] for x in classes],
            },
            files={"file": ("DCN201_W7_multiplexing.pdf", b"%PDF-1.4 test", "application/pdf")},
        )
        assert r.status_code == 201, r.text
        assert r.json()["students"] == 79 and len(r.json()["material_ids"]) == 2
        page = (await c.get(f"/staff/teaching/classes/{classes[0]['offering_id']}")).json()
        assert page["notes"][0]["title"] == "Multiplexing, part 1"
    async with signed_in("TCFL/2027/0142") as c:
        notes = (await c.get("/student/modules/DCN201")).json()["notes"]
        assert notes[0]["title"] == "Multiplexing, part 1"


async def _dit_dcn201_slot_this_week():
    """A DCN201 DIT-1A timetable slot and its date within the last week."""
    async with get_sessionmaker()() as db:
        slot = (
            (
                await db.execute(
                    select(TimetableSlot)
                    .join(ModuleOffering, ModuleOffering.id == TimetableSlot.offering_id)
                    .where(ModuleOffering.class_group == "DIT-1A", TimetableSlot.day_of_week == 1)
                )
            )
            .unique()
            .scalars()
            .all()
        )
    slot = next(s for s in slot if s.offering.module.code == "DCN201")
    today = clock.today()
    return slot, today - timedelta(days=(today.isoweekday() - slot.day_of_week) % 7)


async def test_register():
    slot, day = await _dit_dcn201_slot_this_week()
    async with signed_in(LECTURER) as c:
        reg = (await c.get(f"/staff/teaching/register/{slot.id}/{day.isoformat()}")).json()
        assert len(reg["rows"]) == 38 and all(r["status"] is None for r in reg["rows"])
        sid = reg["session_id"]
        first, second = reg["rows"][0]["student_id"], reg["rows"][1]["student_id"]
        assert (
            await c.put(f"/staff/teaching/register/{sid}/students/{first}", json={"status": "absent"})
        ).status_code == 204
        assert (
            await c.put(f"/staff/teaching/register/{sid}/students/{second}", json={"status": "late"})
        ).status_code == 204
        assert (await c.post(f"/staff/teaching/register/{sid}/finish")).status_code == 409  # 36 not marked
        assert (await c.post(f"/staff/teaching/register/{sid}/rest-present")).status_code == 204
        done = (await c.post(f"/staff/teaching/register/{sid}/finish")).json()
        assert done == {"present": 36, "late": 1, "absent": 1}
        again = (await c.get(f"/staff/teaching/register/{slot.id}/{day.isoformat()}")).json()
        assert again["session_id"] == sid and again["finished_at"]
