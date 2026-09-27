"""Intake places, the library catalogue and reading lists, and Find a student."""

import uuid

import pytest
from sqlalchemy import text

from app.db import get_sessionmaker
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio


# --- intake places ----------------------------------------------------------------------------


async def test_places_start_unset_and_count_offers():
    async with signed_in("cmarufu") as c:
        r = (await c.get("/staff/admissions/places")).json()
    assert r["intake"] == "2027 intake"
    dit = next(p for p in r["programmes"] if p["code"] == "DIT")
    assert dit["places"] is None and dit["remaining"] is None  # not set until Admissions sets it
    assert dit["offered"] >= 1  # Munashe Chari was offered a place
    assert dit["in_queue"] >= 1


async def test_admissions_sets_places_and_sees_what_remains():
    async with signed_in("cmarufu") as c:
        dit = next(
            p for p in (await c.get("/staff/admissions/places")).json()["programmes"] if p["code"] == "DIT"
        )
        r = (await c.put(f"/staff/admissions/places/{dit['programme_id']}", json={"places": 60})).json()
        again = (await c.put(f"/staff/admissions/places/{dit['programme_id']}", json={"places": 55})).json()
        bad = await c.put(f"/staff/admissions/places/{dit['programme_id']}", json={"places": -1})
    now = next(p for p in r["programmes"] if p["code"] == "DIT")
    assert now["places"] == 60 and now["remaining"] == 60 - (now["offered"] - now["declined"])
    assert next(p for p in again["programmes"] if p["code"] == "DIT")["places"] == 55
    assert bad.status_code == 422


async def test_only_admissions_manages_places():
    async with signed_in("schinembiri") as c:
        assert (await c.get("/staff/admissions/places")).status_code == 403


# --- catalogue and reading lists --------------------------------------------------------------


async def test_catalogue_search_counts_copies_and_loans():
    async with signed_in("schinembiri") as c:
        books = (await c.get("/staff/library/catalogue", params={"q": "forouzan"})).json()
        by_barcode = (await c.get("/staff/library/catalogue", params={"q": "TCFL-B-003390"})).json()
    forouzan = books[0]
    assert forouzan["title"] == "Data Communications and Networking"
    assert forouzan["copies"] == 2 and forouzan["on_loan"] == 2 and forouzan["available"] == 0
    assert [b["id"] for b in by_barcode] == [forouzan["id"]]


async def test_librarian_adds_a_book_and_a_copy():
    code = f"TCFL-B-9{uuid.uuid4().int % 100000:05d}"
    async with signed_in("schinembiri") as c:
        r = await c.post(
            "/staff/library/catalogue",
            json={
                "title": "Digital Fundamentals",
                "authors": ["Floyd, Thomas"],
                "edition": "11th edition",
                "year": 2014,
                "call_number": "621.381 FLO",
                "copies": [{"barcode": code.lower(), "location": "Shelf 4"}],
            },
        )
        assert r.status_code == 201, r.text
        book = r.json()
        assert book["barcodes"] == [code] and book["available"] == 1
        dup = await c.post(f"/staff/library/catalogue/{book['id']}/copies", json={"barcode": code})
        assert dup.status_code == 409 and code in dup.json()["detail"]
        more = await c.post(f"/staff/library/catalogue/{book['id']}/copies", json={"barcode": code + "A"})
        assert more.json()["copies"] == 2


async def test_reading_lists_add_and_remove_a_book():
    async with signed_in("schinembiri") as c:
        lists = (await c.get("/staff/library/reading-lists")).json()
        net = next(m for m in lists if m["module_code"] == "NET202" and m["class_group"] == "DIT-1A")
        book = (await c.get("/staff/library/catalogue", params={"q": "kochan"})).json()[0]
        added = (
            await c.post(
                f"/staff/library/reading-lists/{net['offering_id']}/books",
                json={"item_id": book["id"], "is_core": False, "note": "For the C labs"},
            )
        ).json()
        listed = next(m for m in added if m["offering_id"] == net["offering_id"])["books"]
        assert any(b["item_id"] == book["id"] and b["note"] == "For the C labs" for b in listed)
        removed = (
            await c.delete(f"/staff/library/reading-lists/{net['offering_id']}/books/{book['id']}")
        ).json()
        assert all(
            b["item_id"] != book["id"]
            for b in next(m for m in removed if m["offering_id"] == net["offering_id"])["books"]
        )


async def test_catalogue_is_for_librarians():
    async with signed_in("TCFL/2027/0142") as c:
        assert (await c.get("/staff/library/catalogue")).status_code == 403


# --- find a student ---------------------------------------------------------------------------


async def test_find_a_student_by_name_or_number_and_the_view_is_audited():
    async with signed_in("tmushonga") as c:
        by_name = (await c.get("/staff/students", params={"q": "tariro moyo"})).json()
        by_number = (await c.get("/staff/students", params={"q": "0147"})).json()
        profile = (await c.get("/staff/students/TCFL/2027/0142")).json()
        missing = await c.get("/staff/students/TCFL/2027/9999")
    assert [s["student_number"] for s in by_name] == ["TCFL/2027/0142"]
    assert by_number[0]["name"] == "Thandeka Mpofu"
    assert profile["class_group"] == "DIT-1A" and profile["phone"] == "+263773184521"
    assert "Engineering Mathematics" in [ln["title"] for ln in profile["loans"]]
    assert "national_id" not in profile and "date_of_birth" not in profile
    assert missing.status_code == 404
    async with get_sessionmaker()() as db:
        n = await db.scalar(
            text(
                "SELECT count(*) FROM audit_log WHERE action = 'student.view' "
                "AND entity_id = 'TCFL/2027/0142'"
            )
        )
    assert n >= 1


async def test_lecturers_and_students_cannot_look_students_up():
    for who in ("fchikore", "TCFL/2027/0147"):
        async with signed_in(who) as c:
            assert (await c.get("/staff/students", params={"q": "moyo"})).status_code == 403
