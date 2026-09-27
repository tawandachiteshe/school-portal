"""Student modules: list, module overview (classes this week, assessments, notes), note downloads."""

import uuid
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.api.me import term_info
from app.auth.deps import CurrentUser, current_user
from app.config import get_settings
from app.db import get_db
from app.models import Assessment, CourseMaterial, MaterialDownload, ModuleOffering, Student, Submission
from app.services import clock, timetable
from app.services.students import current_offerings, current_student

router = APIRouter(prefix="/student", tags=["modules"])

NEW_NOTE_DAYS = 7


class Lecturer(BaseModel):
    name: str
    consultation_hours: str | None
    office: str | None
    email: str | None


class NextClass(BaseModel):
    starts_at: datetime
    venue: str | None


class ModuleSummary(BaseModel):
    code: str
    name: str
    lecturer: str | None
    next_class: NextClass | None
    new_notes: int


class ModuleList(BaseModel):
    term_name: str | None
    class_group: str | None
    modules: list[ModuleSummary]


class WeekClass(BaseModel):
    kind: str
    starts_at: datetime
    ends_at: datetime
    venue: str | None
    cancelled: bool
    change_reason: str | None
    assessment_title: str | None


class ModuleAssessment(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    weight: float
    due_at: datetime
    venue: str | None
    submission_mode: str
    status: str | None  # submission status, None if nothing handed in
    submitted_at: datetime | None
    mark: float | None  # only once marks are released
    max_mark: float


class Note(BaseModel):
    id: uuid.UUID
    title: str
    week: int | None
    topic: str | None
    mime_type: str | None
    size_bytes: int | None
    published_at: datetime
    downloaded: bool
    external_url: str | None


class ModuleDetail(BaseModel):
    code: str
    name: str
    term_name: str
    class_group: str
    lecturer: Lecturer | None
    coursework_weight: float
    exam_weight: float
    week: int | None
    week_classes: list[WeekClass]
    assessments: list[ModuleAssessment]
    exam_scheduled: bool
    notes: list[Note]


def _lead(o: ModuleOffering):
    lead = next((ol for ol in o.lecturers if ol.role == "lead"), None) or (
        o.lecturers[0] if o.lecturers else None
    )
    return lead.staff if lead else None


async def _downloaded(db: AsyncSession, user_id: uuid.UUID, material_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not material_ids:
        return set()
    rows = await db.execute(
        select(MaterialDownload.material_id).where(
            MaterialDownload.user_id == user_id, MaterialDownload.material_id.in_(material_ids)
        )
    )
    return set(rows.scalars())


def _published(now: datetime):
    return CourseMaterial.published_at.is_not(None), CourseMaterial.published_at <= now


@router.get("/modules")
async def list_modules(
    cu: CurrentUser = Depends(current_user),
    student: Student = Depends(current_student),
    db: AsyncSession = Depends(get_db),
) -> ModuleList:
    now = clock.now()
    offerings = await current_offerings(db, student)
    ids = [o.id for o in offerings]
    upcoming = await timetable.occurrences(db, ids, [now.date() + timedelta(days=i) for i in range(8)])
    recent = (
        await db.execute(
            select(CourseMaterial.id, CourseMaterial.offering_id).where(
                CourseMaterial.offering_id.in_(ids),
                *_published(now),
                CourseMaterial.published_at >= now - timedelta(days=NEW_NOTE_DAYS),
            )
        )
    ).all()
    downloaded = await _downloaded(db, cu.user.id, [r.id for r in recent])

    modules = []
    for o in sorted(offerings, key=lambda o: o.module.code):
        nxt = next(
            (c for c in upcoming if c.offering_id == o.id and c.ends_at > now and not c.cancelled), None
        )
        lead = _lead(o)
        modules.append(
            ModuleSummary(
                code=o.module.code,
                name=o.module.name,
                lecturer=lead.short_name if lead else None,
                next_class=NextClass(starts_at=nxt.starts_at, venue=nxt.venue) if nxt else None,
                new_notes=sum(1 for r in recent if r.offering_id == o.id and r.id not in downloaded),
            )
        )
    # Order like the design: soonest next class first; modules with no class this week last.
    modules.sort(
        key=lambda m: m.next_class.starts_at if m.next_class else datetime.max.replace(tzinfo=now.tzinfo)
    )
    term = offerings[0].term if offerings else None
    return ModuleList(term_name=term.name if term else None, class_group=student.class_group, modules=modules)


async def _offering_for(db: AsyncSession, student: Student, code: str) -> ModuleOffering:
    o = next((o for o in await current_offerings(db, student) if o.module.code == code.upper()), None)
    if o is None:
        raise HTTPException(404, "You're not taking this module this semester.")
    return o


@router.get("/modules/{code}")
async def module_detail(
    code: str,
    cu: CurrentUser = Depends(current_user),
    student: Student = Depends(current_student),
    db: AsyncSession = Depends(get_db),
) -> ModuleDetail:
    now = clock.now()
    o = await _offering_for(db, student, code)
    monday = now.date() - timedelta(days=now.weekday())
    week_classes = await timetable.occurrences(db, [o.id], [monday + timedelta(days=i) for i in range(7)])
    week_start = monday
    if week_classes and all(c.ends_at <= now for c in week_classes):
        # This week is over (e.g. at the weekend): show next week's classes instead.
        week_start = monday + timedelta(days=7)
        week_classes = await timetable.occurrences(
            db, [o.id], [week_start + timedelta(days=i) for i in range(7)]
        )

    assessments = (
        (
            await db.execute(
                select(Assessment)
                .where(Assessment.offering_id == o.id, Assessment.published_at.is_not(None))
                .order_by(Assessment.due_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    subs = {
        s.assessment_id: s
        for s in (
            await db.execute(
                select(Submission).where(
                    Submission.student_id == student.id,
                    Submission.assessment_id.in_([a.id for a in assessments]),
                )
            )
        ).scalars()
    }
    notes = (
        (
            await db.execute(
                select(CourseMaterial)
                .where(CourseMaterial.offering_id == o.id, *_published(now))
                .order_by(CourseMaterial.published_at.desc())
            )
        )
        .unique()
        .scalars()
        .all()
    )
    downloaded = await _downloaded(db, cu.user.id, [n.id for n in notes])
    lead = _lead(o)
    cw = float(o.module.coursework_weight)

    def released(a: Assessment) -> bool:
        return a.marks_released_at is not None and a.marks_released_at <= now

    return ModuleDetail(
        code=o.module.code,
        name=o.module.name,
        term_name=o.term.name,
        class_group=o.class_group,
        lecturer=Lecturer(
            name=lead.short_name,
            consultation_hours=lead.consultation_hours,
            office=lead.office,
            email=lead.work_email,
        )
        if lead
        else None,
        coursework_weight=cw,
        exam_weight=100 - cw,
        week=term_info(o.term, max(week_start, now.date())).week,
        week_classes=[
            WeekClass(
                kind=c.kind,
                starts_at=c.starts_at,
                ends_at=c.ends_at,
                venue=c.venue,
                cancelled=c.cancelled,
                change_reason=c.change_reason,
                assessment_title=c.assessment_title,
            )
            for c in week_classes
        ],
        assessments=[
            ModuleAssessment(
                id=a.id,
                kind=a.kind,
                title=a.title,
                weight=float(a.weight),
                due_at=a.due_at,
                venue=a.venue.name if a.venue else None,
                submission_mode=a.submission_mode,
                status=subs[a.id].status if a.id in subs and subs[a.id].status != "draft" else None,
                submitted_at=subs[a.id].submitted_at if a.id in subs else None,
                mark=float(subs[a.id].mark)
                if a.id in subs and subs[a.id].mark is not None and released(a)
                else None,
                max_mark=float(a.max_mark),
            )
            for a in assessments
        ],
        exam_scheduled=any(a.kind == "exam" for a in assessments),
        notes=[
            Note(
                id=n.id,
                title=n.title,
                week=n.week,
                topic=n.topic,
                mime_type=n.mime_type,
                size_bytes=n.size_bytes,
                published_at=n.published_at,
                downloaded=n.id in downloaded,
                external_url=n.external_url,
            )
            for n in notes
            if n.published_at
        ],
    )


EXT = {"application/pdf": "pdf"}


@router.get("/materials/{material_id}/download")
async def download_material(
    material_id: uuid.UUID,
    cu: CurrentUser = Depends(current_user),
    student: Student = Depends(current_student),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    m = await db.get(CourseMaterial, material_id)
    now = clock.now()
    allowed = {o.id for o in await current_offerings(db, student)}
    if (
        m is None
        or m.offering_id not in allowed
        or not m.published_at
        or m.published_at > now
        or not m.object_key
    ):
        raise HTTPException(404, "This file isn't available.")
    bucket = get_settings().s3_bucket_content
    size = storage.size(bucket, m.object_key)
    if size is None:
        raise HTTPException(404, "This file is missing. Tell your lecturer.")

    await db.execute(
        insert(MaterialDownload)
        .values(material_id=m.id, user_id=cu.user.id)
        .on_conflict_do_update(
            index_elements=["material_id", "user_id"],
            set_={"last_at": func.now(), "count": MaterialDownload.count + 1},
        )
    )
    await db.commit()

    ext = m.object_key.rsplit(".", 1)[-1] if "." in m.object_key else EXT.get(m.mime_type or "", "bin")
    filename = f"{m.offering.module.code} {m.title}.{ext}"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "Content-Length": str(size),
        "Cache-Control": "private, max-age=86400",
    }
    return StreamingResponse(
        storage.stream(bucket, m.object_key),
        media_type=m.mime_type or "application/octet-stream",
        headers=headers,
    )
