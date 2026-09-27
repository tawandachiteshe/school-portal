"""docs/07 "Audit log": staff views of applications and documents, and decisions, are recorded
with who, when and from where."""

import pytest
from sqlalchemy import text

from app.db import get_sessionmaker
from tests.helpers import signed_in

pytestmark = pytest.mark.anyio


async def _audit(action: str, entity_id: str) -> list[dict]:
    async with get_sessionmaker()() as db:
        rows = await db.execute(
            text(
                "SELECT a.action, a.actor_role, a.after, u.username FROM audit_log a "
                "JOIN users u ON u.id = a.actor_id WHERE a.action = :a AND a.entity_id = :e"
            ),
            {"a": action, "e": entity_id},
        )
        return [dict(r._mapping) for r in rows]


async def test_opening_an_application_and_its_id_photo_is_recorded():
    async with signed_in("cmarufu") as c:
        r = (await c.get("/staff/admissions/applications/APP-27-08880")).json()
        doc = r["identity"]["document_id"]
        assert (await c.get(f"/staff/admissions/documents/{doc}/file")).status_code == 200
    views = await _audit("application.view", "APP-27-08880")
    assert views and views[-1]["username"] == "cmarufu" and views[-1]["actor_role"] == "admissions"
    photo = await _audit("document.view", doc)
    assert photo and photo[-1]["after"] == {"kind": "national_id"}


async def test_a_decision_is_recorded():
    async with signed_in("cmarufu") as c:
        r = await c.post(
            "/staff/admissions/applications/APP-27-08852/decision",
            json={"decision": "ask", "message": "Please upload page 2 of your slip."},
        )
        assert r.status_code == 200, r.text
    assert (await _audit("application.decide", "APP-27-08852"))[-1]["after"] == {"status": "more_info"}
