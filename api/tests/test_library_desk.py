import pytest

from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
LIBRARIAN = "schinembiri"


async def test_only_librarians():
    async with signed_in("CC/2027/0142") as c:
        assert (await c.get("/staff/library/today")).status_code == 403


async def test_find_borrower_by_card_barcode():
    async with signed_in(LIBRARIAN) as c:
        b = (await c.get("/staff/library/borrowers/CC20270142")).json()
    assert b["name"] == "Tariro Moyo" and b["class_group"] == "DIT-1A"
    assert b["overdue"] == 1
    assert {x["barcode"] for x in b["loans"]} == {"CC-B-001873", "CC-B-003390"}
    assert b["held"][0]["barcode"] == "CC-B-004512"


async def test_issue_needs_overdue_books_back_or_an_override():
    async with signed_in(LIBRARIAN) as c:
        b = (await c.get("/staff/library/borrowers/CC/2027/0142")).json()
        copy = (await c.get("/staff/library/copies/CC-B-004512")).json()
        assert copy["held_for"] == "Tariro Moyo"
        r = await c.post("/staff/library/loans", json={"person_id": b["person_id"], "barcode": "CC-B-004512"})
        assert r.status_code == 409 and "overdue" in r.json()["detail"]
        r = await c.post(
            "/staff/library/loans",
            json={"person_id": b["person_id"], "barcode": "CC-B-004512", "allow_with_overdue": True},
        )
        assert r.status_code == 201 and r.json()["sms_queued"] is True
        after = (await c.get("/staff/library/borrowers/CC/2027/0142")).json()
        assert after["held"] == [] and len(after["loans"]) == 3


async def test_held_copy_cannot_go_to_someone_else():
    async with signed_in(LIBRARIAN) as c:
        other = (await c.get("/staff/library/borrowers/CC/2027/0107")).json()
        # Kochan copy is out; the held Tanenbaum copy was issued in the previous test, so use a fresh hold:
        r = await c.post(
            "/staff/library/loans", json={"person_id": other["person_id"], "barcode": "CC-B-001410"}
        )
        assert r.status_code == 409  # already on loan


async def test_return_passes_the_book_to_the_next_reservation():
    async with signed_in("CC/2027/0142") as c:
        kochan = (await c.get("/library/search", params={"q": "kochan"})).json()["books"][0]
        assert (await c.post(f"/library/items/{kochan['id']}/reservations")).status_code == 201
    async with signed_in(LIBRARIAN) as c:
        r = (await c.post("/staff/library/returns", json={"barcode": "CC-B-001410"})).json()
        assert r["borrower"] == "Ropafadzo Chigumba" and r["days_late"] == 8
        assert r["hold_for"] == "Tariro Moyo"
        copy = (await c.get("/staff/library/copies/CC-B-001410")).json()
        assert copy["status"] == "available" and copy["held_for"] == "Tariro Moyo"
        assert (await c.post("/staff/library/returns", json={"barcode": "CC-B-001410"})).status_code == 409


async def test_overdue_list_and_reminders():
    async with signed_in(LIBRARIAN) as c:
        o = (await c.get("/staff/library/overdue")).json()
        first = o["loans"][0]
        assert (first["name"], first["days_late"], first["last_reminder_channel"]) == (
            "Tapiwa Gumbo",
            17,
            "sms",
        )
        assert o["longest"] == 17
        ids = [x["loan_id"] for x in o["loans"] if x["last_reminder_at"] is None]
        r = (await c.post("/staff/library/overdue/remind", json={"loan_ids": ids})).json()
        assert r["reminded"] == len(ids) and r["sms_queued"] + r["no_phone"] == len(ids)
        again = (await c.get("/staff/library/overdue")).json()
        assert all(x["last_reminder_at"] for x in again["loans"])
        csv = await c.get("/staff/library/overdue.csv")
        assert csv.text.startswith("Student,Number,Class,Book") and "Tapiwa Gumbo" in csv.text
