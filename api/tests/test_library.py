import pytest

from tests.helpers import signed_in

pytestmark = pytest.mark.anyio
TARIRO = "CC/2027/0142"


async def test_library_home_matches_the_design():
    async with signed_in(TARIRO) as c:
        h = (await c.get("/library/home")).json()
    assert h["location"] == "Block A"
    assert {x["title"] for x in h["loans"]} == {
        "Engineering Mathematics",
        "Data Communications and Networking",
    }
    stroud = next(x for x in h["loans"] if x["title"] == "Engineering Mathematics")
    assert stroud["overdue"] is True and stroud["edition"] == "7th edition"
    [res] = h["reservations"]
    assert (res["title"], res["status"]) == ("Computer Networks", "ready") and res["collect_by"]
    lists = {x["module_code"]: (x["books"], x["on_shelf"]) for x in h["reading_lists"]}
    assert lists == {"DCN201": (4, 2), "NET202": (3, 0), "PRG101": (2, 2), "MTH110": (3, 1)}


async def test_reading_list_and_search():
    async with signed_in(TARIRO) as c:
        rl = (await c.get("/library/reading-lists/net202")).json()
        assert [b["title"] for b in rl["books"]][0] == "Computer Networks"
        assert rl["books"][0]["reservation"]["status"] == "ready"
        assert all(b["available"] == 0 for b in rl["books"])
        by_title = (await c.get("/library/search", params={"q": "programming language"})).json()["books"]
        assert by_title[0]["title"] == "The C Programming Language" and by_title[0]["available"] == 2
        by_author = (await c.get("/library/search", params={"q": "kurose"})).json()["books"]
        assert by_author[0]["title"].startswith("Computer Networking")
        by_module = (await c.get("/library/search", params={"q": "PRG101"})).json()["books"]
        assert {b["title"] for b in by_module} == {
            "The C Programming Language",
            "C Programming: A Modern Approach",
        }


async def test_reserving():
    async with signed_in(TARIRO) as c:
        books = {
            b["title"]: b for b in (await c.get("/library/search", params={"q": "odom"})).json()["books"]
        }
        odom = books["CCNA 200-301 Official Cert Guide, Volume 1"]
        r = await c.post(f"/library/items/{odom['id']}/reservations")
        assert r.status_code == 201 and r.json()["status"] == "waiting" and r.json()["position"] == 1
        assert (await c.post(f"/library/items/{odom['id']}/reservations")).status_code == 409
        # A book that's on the shelf can't be reserved: ask at the desk.
        kr = (await c.get("/library/search", params={"q": "Kernighan"})).json()["books"][0]
        shelf = await c.post(f"/library/items/{kr['id']}/reservations")
        assert shelf.status_code == 409 and "on the shelf" in shelf.json()["detail"]
        assert (await c.delete(f"/library/reservations/{r.json()['id']}")).status_code == 204
        h = (await c.get("/library/home")).json()
        assert [x["title"] for x in h["reservations"]] == ["Computer Networks"]
