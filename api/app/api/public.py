"""What the landing page shows before anyone signs in (design/Landing, LandingPhone). No session."""

from datetime import date, datetime, time

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.apply import _years, entry_text
from app.config import get_settings
from app.db import DbDep
from app.models import Intake, Programme
from app.services import clock

router = APIRouter(prefix="/public", tags=["public"])


class IntakeInfo(BaseModel):
    name: str  # "2027 intake"
    open: bool  # applications can be made now
    opens_at: datetime
    closes_at: datetime


class ProgrammeInfo(BaseModel):
    code: str
    name: str
    award: str | None
    length: str
    entry: str


class PublicHome(BaseModel):
    intake: IntakeInfo | None  # the open intake, else the next one; none when nothing is planned
    programmes: list[ProgrammeInfo]
    application_fee: str  # "20.00" (US$)
    decision_working_days: int
    registration_at: datetime | None  # first day of the intake's first term, at registration time
    classes_start: date | None
    registration_place: str
    admissions_contact: str  # "" until confirmed
    students_open: bool  # False while only applications are live (STUDENT_PORTAL_OPEN)


@router.get("/home")
async def public_home(db: DbDep) -> PublicHome:
    s = get_settings()
    now = clock.now()
    intake = (
        await db.execute(select(Intake).where(Intake.closes_at > now).order_by(Intake.opens_at).limit(1))
    ).scalar_one_or_none()
    starts = intake.first_term.starts_on if intake and intake.first_term else None
    programmes = (
        await db.execute(
            select(Programme)
            .where(Programme.is_accepting_applications)
            .order_by(Programme.level.desc(), Programme.name)
        )
    ).scalars()
    return PublicHome(
        intake=IntakeInfo(
            name=intake.name,
            open=intake.opens_at <= now,
            opens_at=intake.opens_at,
            closes_at=intake.closes_at,
        )
        if intake
        else None,
        programmes=[
            ProgrammeInfo(
                code=p.code,
                name=p.name,
                award=p.award,
                length=_years(p.duration_terms),
                entry=entry_text(p.entry_rules or {}),
            )
            for p in programmes
        ],
        application_fee=s.application_fee_usd,
        decision_working_days=s.admissions_decision_working_days,
        registration_at=clock.at(starts, time.fromisoformat(s.registration_time)) if starts else None,
        classes_start=starts,
        registration_place=s.registration_location,
        admissions_contact=s.admissions_contact,
        students_open=s.student_portal_open,
    )
