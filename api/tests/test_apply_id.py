from datetime import date, timedelta

import pytest

from app import storage
from app.api import apply_id
from app.ocr.id_reader import IdReading, parse
from app.services import clock
from tests.helpers import client, signed_in

pytestmark = pytest.mark.anyio
NEW = "263772345678"
CARD = "REPUBLIC OF ZIMBABWE\n63-2047823 C 29\nSURNAME\nMOYO\nFIRST NAME\nTARIRO\nDATE OF BIRTH 14/05/2006\n"


@pytest.fixture(autouse=True)
def fake_storage_and_ocr(monkeypatch):
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr(storage, "put", lambda bucket, key, data, ct: blobs.__setitem__(key, data))
    monkeypatch.setattr(storage, "get", lambda bucket, key: blobs[key])

    def read(data: bytes, mime: str, *, allow_llm: bool) -> IdReading:
        return parse(data.decode(), 0.9) if data.startswith(b"REPUBLIC") else IdReading()

    monkeypatch.setattr(apply_id, "read_national_id", read)


def test_parse_card_text():
    r = parse(CARD, 0.9)
    assert (r.id_number, r.surname, r.first_names, r.date_of_birth) == (
        "63-2047823 C 29",
        "MOYO",
        "TARIRO",
        date(2006, 5, 14),
    )


def test_device_names():
    ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36"
    assert apply_id.device_of(ua) == ("phone", "Android · Chrome")


async def _start(c) -> None:
    progs = {p["code"]: p["id"] for p in (await c.get("/apply/programmes")).json()}
    await c.put("/apply/application/programme", json={"programme_id": progs["DIT"]})


async def test_upload_read_and_confirm_on_the_computer():
    async with signed_in(NEW) as c:
        await _start(c)
        r = await c.post("/apply/national-id", files={"file": ("id.jpg", CARD.encode(), "image/jpeg")})
        assert r.status_code == 200
        s = (await c.get("/apply/national-id")).json()
        assert s["status"] == "read" and s["fields"]["id_number"] == "63-2047823 C 29"
        assert s["check_letter_valid"] and s["registered_in"] == "Harare" and s["origin"] == "Gweru"
        # A wrong letter is refused; the digits' letter is C.
        bad = {
            "id_number": "63-2047823 P 29",
            "surname": "MOYO",
            "first_names": "TARIRO",
            "date_of_birth": "2006-05-14",
        }
        assert (await c.put("/apply/national-id", json=bad)).status_code == 422
        # The number is already Tariro's (the student): refused, not merged.
        taken = await c.put("/apply/national-id", json={**bad, "id_number": "63-2047823 C 29"})
        assert taken.status_code == 409
        ok = {**bad, "id_number": "08-2047823 Q 29", "surname": "NYONI", "first_names": "CHIEDZA"}
        s = (await c.put("/apply/national-id", json=ok)).json()
        assert s["status"] == "confirmed" and s["fields"]["surname"] == "NYONI"
        a = (await c.get("/apply/application")).json()
        assert a["steps"]["national_id"] and a["next_step"] == "birth_certificate"


async def test_unreadable_photo_asks_the_applicant_to_type_it():
    async with signed_in(NEW) as c:
        await _start(c)
        await c.post("/apply/national-id", files={"file": ("id.png", b"\x89PNG blurry", "image/png")})
        s = (await c.get("/apply/national-id")).json()
    assert s["status"] == "failed" and s["error"]


async def test_wrong_file_type_and_size():
    async with signed_in(NEW) as c:
        await _start(c)
        r = await c.post("/apply/national-id", files={"file": ("id.gif", b"GIF89a", "image/gif")})
        assert r.status_code == 422


async def test_phone_handoff():
    async with signed_in(NEW) as desk:
        await _start(desk)
        h = (await desk.post("/apply/handoffs", json={})).json()
        assert h["state"] == "waiting" and h["code"].startswith(h["match_code"] + "-")
        async with client() as phone:
            await phone.get("/healthz")
            phone.headers["X-CSRF-Token"] = phone.cookies["portal_csrf"]
            phone.headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36"
            land = (await phone.get(f"/handoff/{h['code']}")).json()
            assert (
                land["state"] == "ready"
                and land["first_name"] == "Chiedza"
                and land["match_code"] == h["match_code"]
            )
            assert (await phone.get("/handoff/session/current")).status_code == 410  # not joined yet
            assert (await phone.post(f"/handoff/{h['code']}/claim")).status_code == 200
            # The QR token works too, but the link is now taken.
            async with client() as other:
                assert (await other.get(f"/handoff/{h['token']}")).json()["state"] == "closed"
            s = (await phone.get("/handoff/session/current")).json()
            assert s["first_name"] == "Chiedza" and s["match_code"] == h["match_code"]
            up = await phone.post(
                "/handoff/session/national-id", files={"file": ("id.jpg", CARD.encode(), "image/jpeg")}
            )
            assert up.status_code == 200
            now = (await desk.get("/apply/handoffs/current")).json()
            assert now["state"] == "connected" and now["device"] == "Android · Chrome"
            assert now["national_id"]["status"] == "read"
            # The computer ends it; the phone can't add anything more.
            assert (await desk.post("/apply/handoffs/current/disconnect")).json()["state"] == "ended"
            assert (await phone.get("/handoff/session/current")).status_code == 410


async def test_expired_link_and_mismatch(monkeypatch):
    async with signed_in(NEW) as desk:
        await _start(desk)
        h = (await desk.post("/apply/handoffs", json={})).json()
        real_now = clock.now
        later = real_now() + timedelta(minutes=16)
        monkeypatch.setattr(clock, "now", lambda: later)
        async with client() as phone:
            assert (await phone.get(f"/handoff/{h['code']}")).json()["state"] == "expired"
        monkeypatch.setattr(clock, "now", real_now)
        h2 = (await desk.post("/apply/handoffs", json={})).json()
        async with client() as phone:
            await phone.get("/healthz")
            phone.headers["X-CSRF-Token"] = phone.cookies["portal_csrf"]
            assert (await phone.post(f"/handoff/{h2['code']}/mismatch")).status_code == 200
            assert (await phone.get(f"/handoff/{h2['code']}")).json()["state"] == "closed"
        assert (await desk.get("/apply/handoffs/current")).json()["state"] == "ended"


async def test_birth_certificate_step():
    async with signed_in(NEW) as c:
        await _start(c)
        await c.put(
            "/apply/national-id",
            json={
                "id_number": "08-2047823 Q 29",
                "surname": "NYONI",
                "first_names": "CHIEDZA",
                "date_of_birth": "2006-05-14",
            },
        )
        a = (await c.get("/apply/application")).json()
        assert a["next_step"] == "birth_certificate" and not a["steps"]["birth_certificate"]
        s = (await c.get("/apply/birth-certificate")).json()
        assert s["status"] == "none" and s["name"] == "CHIEDZA NYONI"  # starts from the ID
        assert (
            await c.put(
                "/apply/birth-certificate", json={"name": "CHIEDZA NYONI", "date_of_birth": "2006-05-14"}
            )
        ).status_code == 409
        await c.post("/apply/birth-certificate", files={"file": ("bc.jpg", b"certificate", "image/jpeg")})
        s = (
            await c.put(
                "/apply/birth-certificate", json={"name": "Chiedza  Nyoni", "date_of_birth": "2006-05-14"}
            )
        ).json()
        assert s["status"] == "confirmed" and s["matches_id"]
        a = (await c.get("/apply/application")).json()
        assert a["steps"]["birth_certificate"] and a["next_step"] in ("results", "review")
        # A different name is kept, and flagged for Admissions.
        s = (
            await c.put(
                "/apply/birth-certificate", json={"name": "CHIEDZA MOYO", "date_of_birth": "2006-05-14"}
            )
        ).json()
        assert s["matches_id"] is False


async def test_birth_certificate_on_the_review_page():
    async with signed_in("cmarufu") as c:
        r = (await c.get("/staff/admissions/applications/APP-27-08813")).json()
    assert r["identity"]["birth_certificate_id"] and r["identity"]["birth_name"] == "TARIRO MOYO"
