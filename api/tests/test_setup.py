"""app.setup: production reference data and intakes, safe to run again."""

from argparse import Namespace
from datetime import date

import pytest
from sqlalchemy import func, select

from app.db import get_sessionmaker
from app.models import AcademicTerm, DistrictCode, Intake, Programme, ZimsecSubject
from app.setup import intake, reference

pytestmark = pytest.mark.anyio


async def test_reference_data_runs_twice_and_takes_fuller_lists(tmp_path):
    districts = tmp_path / "districts.csv"
    districts.write_text("code,district,province\n7,Chipinge,Manicaland\n")
    subjects = tmp_path / "subjects.csv"
    subjects.write_text("code,name\n4008,Additional Mathematics\n")
    async with get_sessionmaker()() as db:
        await reference(db, str(districts), str(subjects))
        await reference(db, str(districts), str(subjects))
        assert (
            await db.scalar(select(func.count()).select_from(Programme).where(Programme.code == "DIT")) == 1
        )
        dte = (await db.execute(select(Programme).where(Programme.code == "DTE"))).scalar_one()
        assert "Physical Science" in dte.entry_rules["required_subjects"]
        assert (await db.get(DistrictCode, "07")).district == "Chipinge"
        assert (await db.get(ZimsecSubject, ("4008", "O"))).name == "Additional Mathematics"


async def test_intake_is_created_then_updated_with_its_first_semester():
    args = Namespace(
        code="2028-FEB",
        name="2028 intake",
        opens=date(2027, 9, 1),
        closes=date(2027, 11, 30),
        classes_start=None,
    )
    async with get_sessionmaker()() as db:
        await intake(db, args)
        args.closes, args.classes_start = date(2027, 12, 15), date(2028, 2, 7)
        await intake(db, args)
        rows = (await db.execute(select(Intake).where(Intake.code == "2028-FEB"))).scalars().all()
        assert len(rows) == 1 and rows[0].closes_at.date() == date(2027, 12, 15)
        term = await db.get(AcademicTerm, rows[0].first_term_id)
        assert term.code == "2028-S1" and term.starts_on == date(2028, 2, 7) and term.is_current is False
