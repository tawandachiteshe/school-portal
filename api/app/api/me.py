from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types import Role
from app.auth.deps import CurrentUser, CurrentUserDep
from app.db import DbDep
from app.models import AcademicTerm, NotificationPreference, Staff, Student

router = APIRouter(tags=["me"])


class StudentInfo(BaseModel):
    student_number: str
    programme_code: str
    programme_name: str
    class_group: str | None
    year_of_study: int


class StaffInfo(BaseModel):
    staff_number: str
    short_name: str
    position: str | None


class TermInfo(BaseModel):
    code: str
    name: str
    week: int | None  # None outside the term dates
    weeks: int


class MeOut(BaseModel):
    id: str
    display_name: str
    given_name: str
    initials: str
    roles: list[Role]
    phone: str | None
    email: str | None
    student: StudentInfo | None
    staff: StaffInfo | None
    term: TermInfo | None


def term_info(term: AcademicTerm, today: date) -> TermInfo:
    weeks = ((term.ends_on - term.starts_on).days // 7) + 1
    week = (today - term.starts_on).days // 7 + 1 if term.starts_on <= today <= term.ends_on else None
    return TermInfo(code=term.code, name=term.name, week=week, weeks=weeks)


@router.get("/me")
async def me(cu: CurrentUserDep, db: DbDep) -> MeOut:
    user, person = cu.user, cu.user.person
    student = staff = None
    if person:
        st = (await db.execute(select(Student).where(Student.person_id == person.id))).scalar_one_or_none()
        if st:
            student = StudentInfo(
                student_number=st.student_number,
                programme_code=st.programme.code,
                programme_name=st.programme.name,
                class_group=st.class_group,
                year_of_study=st.year_of_study,
            )
        sf = (await db.execute(select(Staff).where(Staff.person_id == person.id))).scalar_one_or_none()
        if sf:
            staff = StaffInfo(staff_number=sf.staff_number, short_name=sf.short_name, position=sf.position)
    term = (await db.execute(select(AcademicTerm).where(AcademicTerm.is_current))).scalar_one_or_none()
    name = person.full_name if person else (user.display_name or user.username or "")
    return MeOut(
        id=str(user.id),
        display_name=name,
        given_name=person.given_name if person else name.split(" ")[0],
        initials=person.initials if person else name[:2].upper(),
        roles=sorted(cu.roles),
        phone=user.phone,
        email=user.email,
        student=student,
        staff=staff,
        term=term_info(term, date.today()) if term else None,
    )


class SettingsOut(BaseModel):
    sms_reminders: bool


class SettingsIn(BaseModel):
    sms_reminders: bool | None = None


async def _sms_reminders(db: AsyncSession, cu: CurrentUser) -> bool:
    pref = await db.get(NotificationPreference, (cu.user.id, "deadline", "sms"))
    return True if pref is None else pref.enabled  # on by default (design/More)


@router.get("/me/settings")
async def get_my_settings(cu: CurrentUserDep, db: DbDep) -> SettingsOut:
    return SettingsOut(sms_reminders=await _sms_reminders(db, cu))


@router.patch("/me/settings")
async def update_my_settings(body: SettingsIn, cu: CurrentUserDep, db: DbDep) -> SettingsOut:
    if body.sms_reminders is not None:
        stmt = insert(NotificationPreference).values(
            user_id=cu.user.id, category="deadline", channel="sms", enabled=body.sms_reminders
        )
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["user_id", "category", "channel"], set_={"enabled": body.sms_reminders}
            )
        )
        await db.commit()
    return SettingsOut(sms_reminders=await _sms_reminders(db, cu))
