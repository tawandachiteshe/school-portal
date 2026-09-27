import pytest

from tests.helpers import client

pytestmark = pytest.mark.anyio


async def test_landing_page_facts_need_no_session():
    async with client() as c:
        r = await c.get("/public/home")
    assert r.status_code == 200
    home = r.json()
    assert home["intake"]["name"] == "2027 intake" and home["intake"]["open"] is True
    assert home["application_fee"] == "20.00"
    dit = next(p for p in home["programmes"] if p["code"] == "DIT")
    assert dit == {
        "code": "DIT",
        "name": "Diploma in Information Technology",
        "award": "HEXCO National Diploma",
        "length": "3 years",
        "entry": "5 O-Levels at C or better, including English Language and Mathematics",
    }
