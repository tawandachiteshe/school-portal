"""Find a student (no design): for Admissions and Student Affairs. Contact details, programme and
class, and what they have out from the library. Not the National ID, date of birth or results:
those stay on the pages that need them. Each profile view is written to the audit log."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import or_, select

from app.auth.deps import CurrentUser, require_role
from app.db import DbDep
from app.models import LibraryLoan, Person, Student
from app.services import audit, clock

router = APIRouter(prefix="/staff/students", tags=["students"])
staff = require_role("admissions", "student_affairs", "registry", "admin")
StaffDep = Annotated[CurrentUser, Depends(staff)]


class StudentRow(BaseModel):
    student_number: str
    name: str
    programme: str
    class_group: str | None
    status: str


def _name(p: Person) -> str:
    return f"{p.first_names} {p.surname}".strip()


@router.get("")
async def find_students(
    _: StaffDep,
    db: DbDep,
    q: str = Query(min_length=2, max_length=60),
) -> list[StudentRow]:
    """Student number (all or part), or any part of the name."""
    words = [w for w in q.strip().split() if w]
    conds = [Student.student_number.ilike(f"%{q.strip()}%")]
    if words:
        conds.append(
            # Every word in the first names or surname: "tariro moyo", "moyo".
            select(Person.id)
            .where(
                Person.id == Student.person_id,
                *[or_(Person.first_names.ilike(f"%{w}%"), Person.surname.ilike(f"%{w}%")) for w in words],
            )
            .exists()
        )
    rows = (
        (await db.execute(select(Student).where(or_(*conds)).order_by(Student.student_number).limit(25)))
        .unique()
        .scalars()
        .all()
    )
    return [
        StudentRow(
            student_number=s.student_number,
            name=_name(s.person),
            programme=s.programme.name,
            class_group=s.class_group,
            status=s.status,
        )
        for s in rows
    ]


class StudentLoan(BaseModel):
    title: str
    due_at: datetime
    overdue: bool


class StudentProfile(BaseModel):
    student_number: str
    name: str
    programme: str
    class_group: str | None
    year_of_study: int
    study_mode: str
    status: str
    intake: str | None
    phone: str | None
    email: str | None
    fees_cleared: bool
    loans: list[StudentLoan]


@router.get("/{number:path}")
async def student_profile(number: str, request: Request, cu: StaffDep, db: DbDep) -> StudentProfile:
    s = (
        await db.execute(select(Student).where(Student.student_number == number.upper()))
    ).scalar_one_or_none()
    if s is None:
        raise HTTPException(404, "No student with that number")
    now = clock.now()
    loans = (
        (
            await db.execute(
                select(LibraryLoan)
                .where(LibraryLoan.person_id == s.person_id, LibraryLoan.returned_at.is_(None))
                .order_by(LibraryLoan.due_at)
            )
        )
        .scalars()
        .all()
    )
    user = s.person.user
    await audit.record(db, cu, request, "student.view", "student", s.student_number)
    await db.commit()
    return StudentProfile(
        student_number=s.student_number,
        name=_name(s.person),
        programme=s.programme.name,
        class_group=s.class_group,
        year_of_study=(s.current_term_number + 1) // 2,
        study_mode=s.study_mode,
        status=s.status,
        intake=s.intake.name if s.intake else None,
        phone=user.phone if user else None,
        email=user.email if user else None,
        fees_cleared=s.fees_cleared,
        loans=[
            StudentLoan(title=ln.copy.item.title, due_at=ln.due_at, overdue=ln.due_at < now) for ln in loans
        ],
    )
