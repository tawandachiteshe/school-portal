"""Lecturer screens (design/LecturerHome, LecturerMarks, LecturerUpload, Register)."""

import hashlib
import re
import uuid
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.api.me import TermInfo, term_info
from app.api.modules import WeeklySlot
from app.api.types import AssessmentKind, ClassKind
from app.auth.deps import CurrentUser, require_role
from app.config import get_settings
from app.db import get_db
from app.models import (
    AcademicTerm,
    Assessment,
    Attendance,
    ClassSession,
    CourseMaterial,
    Enrolment,
    MaterialDownload,
    ModuleOffering,
    Notification,
    OfferingLecturer,
    Staff,
    Student,
    Submission,
    TimetableSlot,
)
from app.services import clock, timetable

router = APIRouter(prefix="/staff/teaching", tags=["teaching"])
_lecturer_role = require_role("lecturer")


class Lecturer:
    def __init__(self, cu: CurrentUser, staff: Staff):
        self.cu = cu
        self.staff = staff


async def current_lecturer(
    cu: CurrentUser = Depends(_lecturer_role), db: AsyncSession = Depends(get_db)
) -> Lecturer:
    person = cu.user.person
    staff = (
        (await db.execute(select(Staff).where(Staff.person_id == person.id))).scalar_one_or_none()
        if person
        else None
    )
    if staff is None:
        raise HTTPException(403, "No staff record for this account")
    return Lecturer(cu, staff)


async def my_offerings(db: AsyncSession, lec: Lecturer) -> list[ModuleOffering]:
    rows = await db.execute(
        select(ModuleOffering)
        .join(OfferingLecturer, OfferingLecturer.offering_id == ModuleOffering.id)
        .where(OfferingLecturer.staff_id == lec.staff.id)
    )
    return sorted(
        [o for o in rows.unique().scalars() if o.term.is_current],
        key=lambda o: (o.module.code, o.class_group),
    )


async def _offering(db: AsyncSession, lec: Lecturer, offering_id: uuid.UUID) -> ModuleOffering:
    o = next((o for o in await my_offerings(db, lec) if o.id == offering_id), None)
    if o is None:
        raise HTTPException(404, "You don't teach this class.")
    return o


async def roster(db: AsyncSession, offering_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Student]]:
    rows = await db.execute(
        select(Enrolment.offering_id, Student)
        .join(Student, Student.id == Enrolment.student_id)
        .where(
            Enrolment.offering_id.in_(offering_ids),
            Enrolment.dropped_at.is_(None),
            Student.status == "active",
        )
    )
    out: dict[uuid.UUID, list[Student]] = {i: [] for i in offering_ids}
    for oid, st in rows.unique().all():
        out[oid].append(st)
    for v in out.values():
        v.sort(key=lambda s: (s.person.surname, s.person.first_names))
    return out


def sort_name(st: Student) -> str:
    return f"{st.person.surname}, {st.person.first_names}"


# --- overview (design/LecturerHome) ------------------------------------------------------------


class ClassSummary(BaseModel):
    offering_id: uuid.UUID
    module_code: str
    module_name: str
    class_group: str
    students: int


class TeachingClass(BaseModel):
    slot_id: uuid.UUID
    on_date: date
    offering_id: uuid.UUID
    module_code: str
    class_group: str
    kind: ClassKind
    starts_at: datetime
    ends_at: datetime
    venue: str | None
    assessment_title: str | None
    students: int
    register_taken: bool
    cancelled: bool


class MarkingItem(BaseModel):
    assessment_id: uuid.UUID
    kind: AssessmentKind
    title: str
    module_code: str
    class_group: str
    offering_id: uuid.UUID
    due_at: datetime
    students: int
    marked: int
    absent: int
    marks_due_on: date | None
    released: bool


class SharedNote(BaseModel):
    title: str
    week: int | None
    mime_type: str | None
    size_bytes: int | None
    published_at: datetime
    class_groups: list[str]
    downloaded: int
    audience: int
    first_material_id: uuid.UUID


class Overview(BaseModel):
    greeting_name: str  # "Eng. Chikore"
    term: TermInfo | None
    classes: list[ClassSummary]
    today: list[TeachingClass]
    marking: list[MarkingItem]
    notes: list[SharedNote]


async def _marking(db: AsyncSession, offerings: list[ModuleOffering], counts: dict, include_released: bool):
    now = clock.now()
    by_id = {o.id: o for o in offerings}
    q = select(Assessment).where(
        Assessment.offering_id.in_(by_id), Assessment.published_at.is_not(None), Assessment.due_at <= now
    )
    if not include_released:
        q = q.where(Assessment.marks_released_at.is_(None))
    items = (await db.execute(q.order_by(Assessment.due_at.desc()))).unique().scalars().all()
    stats = {
        r[0]: (r[1], r[2])
        for r in await db.execute(
            select(
                Submission.assessment_id,
                func.count().filter(Submission.mark.is_not(None)),
                func.count().filter(Submission.is_absent),
            )
            .where(Submission.assessment_id.in_([a.id for a in items]))
            .group_by(Submission.assessment_id)
        )
    }
    out = [
        MarkingItem(
            assessment_id=a.id,
            kind=a.kind,
            title=a.title,
            module_code=by_id[a.offering_id].module.code,
            class_group=by_id[a.offering_id].class_group,
            offering_id=a.offering_id,
            due_at=a.due_at,
            students=counts[a.offering_id],
            marked=stats.get(a.id, (0, 0))[0],
            absent=stats.get(a.id, (0, 0))[1],
            marks_due_on=a.marks_due_on,
            released=a.marks_released_at is not None,
        )
        for a in items
    ]
    # Most urgent first: nearest marks deadline, released last.
    out.sort(key=lambda m: (m.released, m.marks_due_on or date.max))
    return out


async def _shared_notes(db: AsyncSession, offerings: list[ModuleOffering], counts: dict, limit: int | None):
    by_id = {o.id: o for o in offerings}
    rows = (
        (
            await db.execute(
                select(CourseMaterial)
                .where(CourseMaterial.offering_id.in_(by_id), CourseMaterial.published_at.is_not(None))
                .order_by(CourseMaterial.published_at.desc())
            )
        )
        .unique()
        .scalars()
        .all()
    )
    # One file shared with several classes is one note ("DIT-1A, DTE-1A").
    groups: dict[str, list[CourseMaterial]] = {}
    for m in rows:
        groups.setdefault(m.object_key or str(m.id), []).append(m)
    downloads = {
        r[0]: r[1]
        for r in await db.execute(
            select(MaterialDownload.material_id, func.count())
            .where(MaterialDownload.material_id.in_([m.id for m in rows]))
            .group_by(MaterialDownload.material_id)
        )
    }
    out = []
    for ms in list(groups.values())[:limit]:
        first = ms[0]
        out.append(
            SharedNote(
                title=first.title,
                week=first.week,
                mime_type=first.mime_type,
                size_bytes=first.size_bytes,
                published_at=first.published_at,
                class_groups=sorted(by_id[m.offering_id].class_group for m in ms),
                downloaded=sum(downloads.get(m.id, 0) for m in ms),
                audience=sum(counts[m.offering_id] for m in ms),
                first_material_id=first.id,
            )
        )
    return out


@router.get("/overview")
async def overview(lec: Lecturer = Depends(current_lecturer), db: AsyncSession = Depends(get_db)) -> Overview:
    now = clock.now()
    offerings = await my_offerings(db, lec)
    students = await roster(db, [o.id for o in offerings])
    counts = {oid: len(v) for oid, v in students.items()}
    today = await timetable.occurrences(db, [o.id for o in offerings], [now.date()])
    taken = set(
        (
            await db.execute(
                select(ClassSession.slot_id).where(
                    ClassSession.on_date == now.date(), ClassSession.register_taken_at.is_not(None)
                )
            )
        ).scalars()
    )
    term = (await db.execute(select(AcademicTerm).where(AcademicTerm.is_current))).scalar_one_or_none()
    s = lec.staff
    return Overview(
        greeting_name=" ".join(p for p in (s.title, s.person.surname) if p),
        term=term_info(term, now.date()) if term else None,
        classes=[
            ClassSummary(
                offering_id=o.id,
                module_code=o.module.code,
                module_name=o.module.name,
                class_group=o.class_group,
                students=counts[o.id],
            )
            for o in offerings
        ],
        today=[
            TeachingClass(
                slot_id=c.slot_id,
                on_date=now.date(),
                offering_id=c.offering_id,
                module_code=c.module_code,
                class_group=c.class_group,
                kind=c.kind,
                starts_at=c.starts_at,
                ends_at=c.ends_at,
                venue=c.venue,
                assessment_title=c.assessment_title,
                students=counts[c.offering_id],
                register_taken=c.slot_id in taken,
                cancelled=c.cancelled,
            )
            for c in today
        ],
        marking=await _marking(db, offerings, counts, include_released=False),
        notes=await _shared_notes(db, offerings, counts, limit=3),
    )


@router.get("/marking")
async def marking(
    lec: Lecturer = Depends(current_lecturer), db: AsyncSession = Depends(get_db)
) -> list[MarkingItem]:
    offerings = await my_offerings(db, lec)
    counts = {oid: len(v) for oid, v in (await roster(db, [o.id for o in offerings])).items()}
    return await _marking(db, offerings, counts, include_released=True)


# --- marks (design/LecturerMarks) --------------------------------------------------------------


class MarkRow(BaseModel):
    student_id: uuid.UUID
    student_number: str
    name: str  # "Banda, Takudzwa"
    mark: float | None
    is_absent: bool
    absence_note: str | None
    comment: str | None
    submitted_at: datetime | None


class MarksSheet(BaseModel):
    assessment_id: uuid.UUID
    title: str
    kind: AssessmentKind
    module_code: str
    class_group: str
    offering_id: uuid.UUID
    max_mark: float
    weight: float
    due_at: datetime
    marks_due_on: date | None
    released_at: datetime | None
    saved_at: datetime | None
    rows: list[MarkRow]


async def _assessment(db: AsyncSession, lec: Lecturer, assessment_id: uuid.UUID) -> Assessment:
    a = await db.get(Assessment, assessment_id)
    if a is None or a.offering_id not in {o.id for o in await my_offerings(db, lec)}:
        raise HTTPException(404, "This assessment isn't one of your classes.")
    return a


async def _sheet(db: AsyncSession, a: Assessment) -> MarksSheet:
    students = (await roster(db, [a.offering_id]))[a.offering_id]
    subs = {
        s.student_id: s
        for s in (await db.execute(select(Submission).where(Submission.assessment_id == a.id)))
        .unique()
        .scalars()
    }
    saved = max((s.marked_at for s in subs.values() if s.marked_at), default=None)
    return MarksSheet(
        assessment_id=a.id,
        title=a.title,
        kind=a.kind,
        module_code=a.offering.module.code,
        class_group=a.offering.class_group,
        offering_id=a.offering_id,
        max_mark=float(a.max_mark),
        weight=float(a.weight),
        due_at=a.due_at,
        marks_due_on=a.marks_due_on,
        released_at=a.marks_released_at,
        saved_at=saved,
        rows=[
            MarkRow(
                student_id=st.id,
                student_number=st.student_number,
                name=sort_name(st),
                mark=float(subs[st.id].mark) if st.id in subs and subs[st.id].mark is not None else None,
                is_absent=bool(st.id in subs and subs[st.id].is_absent),
                absence_note=subs[st.id].absence_note if st.id in subs else None,
                comment=subs[st.id].feedback_md if st.id in subs else None,
                submitted_at=subs[st.id].submitted_at if st.id in subs else None,
            )
            for st in students
        ],
    )


@router.get("/assessments/{assessment_id}/marks")
async def get_marks(
    assessment_id: uuid.UUID, lec: Lecturer = Depends(current_lecturer), db: AsyncSession = Depends(get_db)
) -> MarksSheet:
    return await _sheet(db, await _assessment(db, lec, assessment_id))


class MarkIn(BaseModel):
    student_id: uuid.UUID
    mark: Decimal | None = Field(default=None, ge=0)
    is_absent: bool = False
    absence_note: str | None = Field(default=None, max_length=500)
    comment: str | None = Field(default=None, max_length=2000)


class MarksIn(BaseModel):
    rows: list[MarkIn]


@router.put("/assessments/{assessment_id}/marks")
async def save_marks(
    assessment_id: uuid.UUID,
    body: MarksIn,
    lec: Lecturer = Depends(current_lecturer),
    db: AsyncSession = Depends(get_db),
) -> MarksSheet:
    """Save a draft (students see marks only after publishing). Rows not sent are left as they are."""
    a = await _assessment(db, lec, assessment_id)
    enrolled = {st.id for st in (await roster(db, [a.offering_id]))[a.offering_id]}
    now = clock.now()
    existing = {
        sub.student_id: sub
        for sub in (await db.execute(select(Submission).where(Submission.assessment_id == a.id)))
        .unique()
        .scalars()
    }
    for r in body.rows:
        if r.student_id not in enrolled:
            raise HTTPException(422, "One of those students isn't in this class.")
        if r.mark is not None and r.mark > a.max_mark:
            raise HTTPException(422, f"Marks can't be more than {a.max_mark:g}.")
        sub = existing.get(r.student_id)
        if sub is None:
            sub = Submission(assessment_id=a.id, student_id=r.student_id, status="draft")
            db.add(sub)
        sub.mark = None if r.is_absent else r.mark
        sub.is_absent = r.is_absent
        sub.absence_note = (r.absence_note or "").strip() or None if r.is_absent else None
        sub.feedback_md = (r.comment or "").strip() or None
        sub.marked_by = lec.cu.user.id
        sub.marked_at = now
        if sub.mark is not None:
            sub.status = "marked"
        elif sub.status == "marked":  # mark cleared: back to what was handed in
            sub.status = "submitted" if sub.submitted_at else "draft"
    await db.commit()
    return await _sheet(db, a)


@router.post("/assessments/{assessment_id}/publish")
async def publish_marks(
    assessment_id: uuid.UUID, lec: Lecturer = Depends(current_lecturer), db: AsyncSession = Depends(get_db)
) -> MarksSheet:
    a = await _assessment(db, lec, assessment_id)
    sheet = await _sheet(db, a)
    missing = [r for r in sheet.rows if r.mark is None and not r.is_absent]
    if missing:
        raise HTTPException(409, f"{len(missing)} students have no mark. Enter a mark or mark them absent.")
    if a.marks_released_at is None:
        a.marks_released_at = clock.now()
        users = {
            st.id: st.person.user_id
            for st in (await roster(db, [a.offering_id]))[a.offering_id]
            if st.person.user_id
        }
        for r in sheet.rows:
            if r.student_id in users:
                db.add(
                    Notification(
                        user_id=users[r.student_id],
                        category="result",
                        title=f"{a.offering.module.code} {a.title}: marks are out",
                        link="/deadlines?show=marked",
                        dedupe_key=f"marks:{a.id}",
                    )
                )
        await db.commit()
    return await _sheet(db, a)


# --- a class (design/LecturerUpload) -----------------------------------------------------------


class ClassStudent(BaseModel):
    id: uuid.UUID
    student_number: str
    name: str
    attended: int  # sessions present or late
    sessions: int  # sessions with a register


class ClassAssessment(BaseModel):
    id: uuid.UUID
    kind: AssessmentKind
    title: str
    due_at: datetime
    weight: float
    marked: int
    released: bool


class ClassPage(BaseModel):
    offering_id: uuid.UUID
    module_code: str
    module_name: str
    class_group: str
    term_name: str
    weekly_slots: list[WeeklySlot]
    students: list[ClassStudent]
    notes: list[SharedNote]
    assessments: list[ClassAssessment]
    other_classes: list[ClassSummary]  # "Share with" in the upload dialog


@router.get("/classes/{offering_id}")
async def class_page(
    offering_id: uuid.UUID, lec: Lecturer = Depends(current_lecturer), db: AsyncSession = Depends(get_db)
) -> ClassPage:
    o = await _offering(db, lec, offering_id)
    offerings = await my_offerings(db, lec)
    all_students = await roster(db, [x.id for x in offerings])
    counts = {oid: len(v) for oid, v in all_students.items()}
    sessions = (
        await db.scalar(
            select(func.count()).where(
                ClassSession.offering_id == o.id, ClassSession.register_taken_at.is_not(None)
            )
        )
        or 0
    )
    attended = {
        r[0]: r[1]
        for r in await db.execute(
            select(Attendance.student_id, func.count())
            .join(ClassSession, ClassSession.id == Attendance.session_id)
            .where(
                ClassSession.offering_id == o.id,
                ClassSession.register_taken_at.is_not(None),
                Attendance.status.in_(["present", "late"]),
            )
            .group_by(Attendance.student_id)
        )
    }
    assessments = (
        (
            await db.execute(
                select(Assessment).where(Assessment.offering_id == o.id).order_by(Assessment.due_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    marked = {
        r[0]: r[1]
        for r in await db.execute(
            select(Submission.assessment_id, func.count())
            .where(Submission.assessment_id.in_([a.id for a in assessments]), Submission.mark.is_not(None))
            .group_by(Submission.assessment_id)
        )
    }
    slots = (
        (await db.execute(select(TimetableSlot).where(TimetableSlot.offering_id == o.id))).unique().scalars()
    )
    return ClassPage(
        offering_id=o.id,
        module_code=o.module.code,
        module_name=o.module.name,
        class_group=o.class_group,
        term_name=o.term.name,
        weekly_slots=[
            WeeklySlot(
                day_of_week=sl.day_of_week,
                starts_at=sl.starts_at.strftime("%H:%M"),
                ends_at=sl.ends_at.strftime("%H:%M"),
                kind=sl.kind,
                venue=sl.venue.name if sl.venue else None,
            )
            for sl in sorted(slots, key=lambda sl: (sl.day_of_week, sl.starts_at))
        ],
        students=[
            ClassStudent(
                id=st.id,
                student_number=st.student_number,
                name=sort_name(st),
                attended=attended.get(st.id, 0),
                sessions=sessions,
            )
            for st in all_students[o.id]
        ],
        notes=await _shared_notes(db, [o], counts, limit=None),
        assessments=[
            ClassAssessment(
                id=a.id,
                kind=a.kind,
                title=a.title,
                due_at=a.due_at,
                weight=float(a.weight),
                marked=marked.get(a.id, 0),
                released=a.marks_released_at is not None,
            )
            for a in assessments
        ],
        other_classes=[
            ClassSummary(
                offering_id=x.id,
                module_code=x.module.code,
                module_name=x.module.name,
                class_group=x.class_group,
                students=counts[x.id],
            )
            for x in offerings
            if x.module_id == o.module_id
        ],
    )


# --- upload notes (design/LecturerUpload dialog) -----------------------------------------------

MAX_NOTE_BYTES = 50 * 1_000_000


class Shared(BaseModel):
    material_ids: list[uuid.UUID]
    students: int


@router.post("/materials", status_code=201)
async def upload_notes(
    file: UploadFile = File(...),
    title: str = Form(min_length=1, max_length=200),
    week: int | None = Form(default=None, ge=1, le=52),
    offering_ids: list[uuid.UUID] = Form(...),
    lec: Lecturer = Depends(current_lecturer),
    db: AsyncSession = Depends(get_db),
) -> Shared:
    mine = {o.id: o for o in await my_offerings(db, lec)}
    if not offering_ids or any(i not in mine for i in offering_ids):
        raise HTTPException(422, "Choose classes you teach.")
    data = await file.read()
    if not data:
        raise HTTPException(422, "This file is empty.")
    if len(data) > MAX_NOTE_BYTES:
        raise HTTPException(422, "Files can be up to 50 MB.")
    name = re.sub(r"[^\w.\- ]+", "_", (file.filename or "notes").rsplit("/", 1)[-1])
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "bin"
    key = f"materials/{hashlib.sha256(data).hexdigest()[:16]}/{uuid.uuid4().hex}.{ext}"
    await storage.put(
        get_settings().s3_bucket_content, key, data, file.content_type or "application/octet-stream"
    )
    now = clock.now()
    ids = []
    for oid in offering_ids:
        m = CourseMaterial(
            offering_id=oid,
            title=title.strip(),
            week=week,
            mime_type=file.content_type or "application/octet-stream",
            size_bytes=len(data),
            object_key=key,
            uploaded_by=lec.cu.user.id,
            published_at=now,
        )
        db.add(m)
        await db.flush()
        ids.append(m.id)
    await db.commit()
    counts = await roster(db, offering_ids)
    return Shared(material_ids=ids, students=sum(len(v) for v in counts.values()))


# --- the register (design/Register) ------------------------------------------------------------


class RegisterRow(BaseModel):
    student_id: uuid.UUID
    student_number: str
    name: str
    status: str | None  # present | late | absent | None (not marked)


class Register(BaseModel):
    session_id: uuid.UUID
    module_code: str
    class_group: str
    title: str  # "Test 1" or "Lecture"
    starts_at: datetime
    venue: str | None
    finished_at: datetime | None
    rows: list[RegisterRow]


async def _register(db: AsyncSession, session: ClassSession, title: str) -> Register:
    students = (await roster(db, [session.offering_id]))[session.offering_id]
    marks = {
        a.student_id: a.status
        for a in (await db.execute(select(Attendance).where(Attendance.session_id == session.id))).scalars()
    }
    return Register(
        session_id=session.id,
        module_code=session.offering.module.code,
        class_group=session.offering.class_group,
        title=title,
        starts_at=session.starts_at,
        venue=session.venue.name if session.venue else None,
        finished_at=session.register_taken_at,
        rows=[
            RegisterRow(
                student_id=st.id,
                student_number=st.student_number,
                name=sort_name(st),
                status=marks.get(st.id),
            )
            for st in students
        ],
    )


KIND_TITLE = {"lecture": "Lecture", "tutorial": "Tutorial", "lab": "Lab", "consultation": "Consultation"}


async def _session_for(db: AsyncSession, lec: Lecturer, slot_id: uuid.UUID, on_date: date):
    slot = await db.get(TimetableSlot, slot_id)
    if slot is None:
        raise HTTPException(404, "No such class.")
    await _offering(db, lec, slot.offering_id)
    occ = next(
        (c for c in await timetable.occurrences(db, [slot.offering_id], [on_date]) if c.slot_id == slot_id),
        None,
    )
    if occ is None:
        raise HTTPException(404, "This class doesn't meet on that day.")
    session = (
        await db.execute(
            select(ClassSession).where(ClassSession.slot_id == slot_id, ClassSession.on_date == on_date)
        )
    ).scalar_one_or_none()
    if session is None:
        session = ClassSession(
            offering_id=slot.offering_id,
            slot_id=slot_id,
            on_date=on_date,
            starts_at=occ.starts_at,
            ends_at=occ.ends_at,
            venue_id=occ.venue_id,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)
    title = occ.assessment_title.split(":")[0] if occ.assessment_title else KIND_TITLE.get(occ.kind, occ.kind)
    return session, title


@router.get("/register/{slot_id}/{on_date}")
async def open_register(
    slot_id: uuid.UUID,
    on_date: date,
    lec: Lecturer = Depends(current_lecturer),
    db: AsyncSession = Depends(get_db),
) -> Register:
    if abs((on_date - clock.today()).days) > 7:
        raise HTTPException(409, "Registers can be taken within a week of the class.")
    session, title = await _session_for(db, lec, slot_id, on_date)
    return await _register(db, session, title)


class MarkAttendance(BaseModel):
    status: str = Field(pattern="^(present|late|absent)$")


async def _own_session(db: AsyncSession, lec: Lecturer, session_id: uuid.UUID) -> ClassSession:
    s = await db.get(ClassSession, session_id)
    if s is None:
        raise HTTPException(404, "No such register.")
    await _offering(db, lec, s.offering_id)
    return s


@router.put("/register/{session_id}/students/{student_id}", status_code=204)
async def mark_attendance(
    session_id: uuid.UUID,
    student_id: uuid.UUID,
    body: MarkAttendance,
    lec: Lecturer = Depends(current_lecturer),
    db: AsyncSession = Depends(get_db),
) -> None:
    s = await _own_session(db, lec, session_id)
    if student_id not in {st.id for st in (await roster(db, [s.offering_id]))[s.offering_id]}:
        raise HTTPException(422, "This student isn't in the class.")
    values = dict(status=body.status, marked_at=clock.now(), marked_by=lec.cu.user.id)
    await db.execute(
        insert(Attendance)
        .values(session_id=s.id, student_id=student_id, **values)
        .on_conflict_do_update(index_elements=["session_id", "student_id"], set_=values)
    )
    await db.commit()


@router.post("/register/{session_id}/rest-present", status_code=204)
async def mark_rest_present(
    session_id: uuid.UUID, lec: Lecturer = Depends(current_lecturer), db: AsyncSession = Depends(get_db)
) -> None:
    s = await _own_session(db, lec, session_id)
    done = set(
        (await db.execute(select(Attendance.student_id).where(Attendance.session_id == s.id))).scalars()
    )
    for st in (await roster(db, [s.offering_id]))[s.offering_id]:
        if st.id not in done:
            db.add(Attendance(session_id=s.id, student_id=st.id, status="present", marked_by=lec.cu.user.id))
    await db.commit()


@router.post("/register/{session_id}/finish")
async def finish_register(
    session_id: uuid.UUID, lec: Lecturer = Depends(current_lecturer), db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    s = await _own_session(db, lec, session_id)
    students = (await roster(db, [s.offering_id]))[s.offering_id]
    marks = {
        a.student_id: a.status
        for a in (await db.execute(select(Attendance).where(Attendance.session_id == s.id))).scalars()
    }
    missing = [st for st in students if st.id not in marks]
    if missing:
        raise HTTPException(409, f"{len(missing)} students aren't marked yet.")
    first = s.register_taken_at is None
    s.register_taken_at = clock.now()
    s.taken_by = lec.cu.user.id
    absent = [st for st in students if marks[st.id] == "absent"]
    if first:
        # design/Register: "Students marked absent get a message asking them to see you."
        when = s.starts_at.astimezone(clock.tz())
        for st in absent:
            if st.person.user_id:
                db.add(
                    Notification(
                        user_id=st.person.user_id,
                        category="system",
                        title=f"Marked absent: {s.offering.module.code} on {when:%a %d %b}, {when:%H:%M}",
                        body=f"Please see {lec.staff.short_name}.",
                        dedupe_key=f"absent:{s.id}",
                    )
                )
    await db.commit()
    return {
        "present": sum(v == "present" for v in marks.values()),
        "late": sum(v == "late" for v in marks.values()),
        "absent": len(absent),
    }
