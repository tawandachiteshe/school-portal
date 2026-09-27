import uuid

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, require_role
from app.db import get_db
from app.models import Enrolment, ModuleOffering, Student, User

_student_role = require_role("student")


async def active_student(db: AsyncSession, user: User) -> Student | None:
    """The user's student record, if it's active."""
    if user.person is None:
        return None
    s = (await db.execute(select(Student).where(Student.person_id == user.person.id))).scalar_one_or_none()
    return s if s and s.status == "active" else None


async def current_student(
    cu: CurrentUser = Depends(_student_role), db: AsyncSession = Depends(get_db)
) -> Student:
    student = await active_student(db, cu.user)
    if student is None:
        raise HTTPException(403, "No active student record for this account")
    return student


async def current_offerings(db: AsyncSession, student: Student) -> list[ModuleOffering]:
    """The student's offerings in the current term (not dropped)."""
    rows = await db.execute(
        select(ModuleOffering)
        .join(Enrolment, Enrolment.offering_id == ModuleOffering.id)
        .where(Enrolment.student_id == student.id, Enrolment.dropped_at.is_(None))
    )
    return [o for o in rows.unique().scalars() if o.term.is_current]


def offering_ids(offerings: list[ModuleOffering]) -> list[uuid.UUID]:
    return [o.id for o in offerings]
