from datetime import timedelta

import pytest

from app import storage
from app.api.apply_submit import local_phone, to_e164
from app.services import clock
from tests.helpers import signed_in
from tests.test_apply_review import _ready, sitting

pytestmark = pytest.mark.anyio
NEW = "263772345678"


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch):
    monkeypatch.setattr(storage, "put", lambda *a: None)


def test_phone_numbers():
    assert to_e164("077 318 4521") == "+263773184521"
    assert to_e164("+263 77 318 4521") == "+263773184521"
    assert to_e164("12345") is None
    assert local_phone("+263773184521") == "077 318 4521"


async def _fresh(c):
    progs = {p["code"]: p["id"] for p in (await c.get("/apply/programmes")).json()}
    await c.put("/apply/application/programme", json={"programme_id": progs["DIT"]})
    await c.post("/apply/application/withdraw")
    await _ready(c)


async def test_declaration_needs_the_tick_and_a_finished_application():
    async with signed_in(NEW) as c:
        await _fresh(c)
        assert (await c.post("/apply/declaration", json={"agree": True})).status_code == 409  # no results yet
        await c.put("/apply/results", json={"sittings": [sitting("C")]})
        r = await c.post("/apply/declaration", json={"agree": False})
        assert r.status_code == 422 and r.json()["detail"] == "Tick the box to confirm your details are true"
        s = (await c.post("/apply/declaration", json={"agree": True})).json()
        assert s["declared"] and s["ready"] and s["fee"] == "20.00"
        assert [m["method"] for m in s["methods"] if m["available"]] == [
            "ecocash",
            "onemoney",
            "cash",
        ]  # no bank details
        assert s["phone"] == "077 234 5678"


async def test_ecocash_prompt_approved_submits_the_application(monkeypatch):
    async with signed_in(NEW) as c:
        await _fresh(c)
        await c.put("/apply/results", json={"sittings": [sitting("C")]})
        await c.post("/apply/declaration", json={"agree": True})
        s = (await c.post("/apply/payments", json={"method": "ecocash", "phone": "077 234 5678"})).json()
        assert (
            s["payment"]["status"] == "awaiting_approval" and s["payment"]["phone_masked"] == "077 ••• 5678"
        )
        assert (await c.get("/apply/submit")).json()["payment"]["status"] == "awaiting_approval"  # not yet
        later = clock.now() + timedelta(seconds=10)
        monkeypatch.setattr(clock, "now", lambda: later)
        s = (await c.get("/apply/submit")).json()
        assert s["payment"]["status"] == "paid" and s["payment"]["receipt"].startswith("EC-")
        a = (await c.get("/apply/application")).json()
        assert a["status"] == "submitted" and a["fee"]["method"] == "EcoCash"
        pdf = await c.get("/apply/application.pdf")
        assert pdf.content.startswith(b"%PDF")


async def test_declined_prompt_and_expiry(monkeypatch):
    async with signed_in(NEW) as c:
        await _fresh(c)
        await c.put("/apply/results", json={"sittings": [sitting("C")]})
        await c.post("/apply/declaration", json={"agree": True})
        await c.post("/apply/payments", json={"method": "ecocash", "phone": "077 123 0000"})
        real = clock.now
        monkeypatch.setattr(clock, "now", lambda: real() + timedelta(seconds=10))
        s = (await c.get("/apply/submit")).json()
        assert s["payment"]["status"] == "failed" and "enough money" in s["payment"]["failure"]
        assert (await c.get("/apply/application")).json()["status"] == "draft"


async def test_cash_waits_for_admissions_to_confirm():
    async with signed_in(NEW) as c:
        await _fresh(c)
        await c.put("/apply/results", json={"sittings": [sitting("C")]})
        await c.post("/apply/declaration", json={"agree": True})
        assert (
            await c.post("/apply/payments", json={"method": "bank"})
        ).status_code == 409  # no bank details yet
        s = (await c.post("/apply/payments", json={"method": "cash"})).json()
        assert s["payment"]["status"] == "awaiting_confirmation"
        a = (await c.get("/apply/application")).json()
        assert a["payment_waiting"] and a["status"] == "draft"
        ref = a["reference"]
    async with signed_in("cmarufu") as c:
        rows = (await c.get("/staff/admissions/payments")).json()
        mine = next(r for r in rows if r["reference"] == ref)
        assert mine["method"] == "cash" and mine["amount"] == "20.00"
        rows = (
            await c.post(f"/staff/admissions/payments/{mine['id']}/confirm", json={"receipt": "AO-1042"})
        ).json()
        assert all(r["reference"] != ref for r in rows)
    async with signed_in(NEW) as c:
        a = (await c.get("/apply/application")).json()
        assert a["status"] == "submitted" and a["fee"]["receipt"] == "AO-1042"
