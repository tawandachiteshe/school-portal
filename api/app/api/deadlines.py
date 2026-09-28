"""Deadlines and online submission with resumable uploads (design/Deadlines, SubmitWork).

Upload flow: POST /assessments/{id}/uploads → PUT /uploads/{id}?offset=N (256 KB chunks, in order)
→ POST /uploads/{id}/complete. A dropped connection resumes from GET /uploads/{id}.received.
Work counts as submitted when the upload finishes (the time of `complete`), as the design says.
"""

import hashlib
import re
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.api.me import term_info
from app.api.types import AssessmentKind, SubmissionMode, SubmissionStatus
from app.config import get_settings
from app.db import DbDep
from app.models import Assessment, Student, Submission, SubmissionFile, UploadSession
from app.services import clock
from app.services.students import StudentDep, current_offerings

router = APIRouter(prefix="/student", tags=["deadlines"])

CHUNK_BYTES = 256 * 1024
DONE = ("submitted", "late", "marked", "returned")


class DeadlineItem(BaseModel):
    id: uuid.UUID
    kind: AssessmentKind
    title: str
    module_code: str
    due_at: datetime
    week: int | None
    venue: str | None
    submission_mode: SubmissionMode
    accepted_extensions: list[str] | None
    allow_late_until: datetime | None
    status: SubmissionStatus | None
    submitted_at: datetime | None
    mark: float | None
    max_mark: float
    feedback: str | None


class Deadlines(BaseModel):
    week: int | None
    items: list[DeadlineItem]


def _released(a: Assessment, now: datetime) -> bool:
    return a.marks_released_at is not None and a.marks_released_at <= now


@router.get("/deadlines")
async def deadlines(student: StudentDep, db: DbDep) -> Deadlines:
    now = clock.now()
    offerings = await current_offerings(db, student)
    rows = (
        (
            await db.execute(
                select(Assessment)
                .where(
                    Assessment.offering_id.in_([o.id for o in offerings]),
                    Assessment.published_at.is_not(None),
                )
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
                    Submission.student_id == student.id, Submission.assessment_id.in_([a.id for a in rows])
                )
            )
        ).scalars()
    }
    term = offerings[0].term if offerings else None
    items = []
    for a in rows:
        s = subs.get(a.id)
        released = _released(a, now)
        items.append(
            DeadlineItem(
                id=a.id,
                kind=a.kind,
                title=a.title,
                module_code=a.offering.module.code,
                due_at=a.due_at,
                week=term_info(term, a.due_at.astimezone(clock.tz()).date()).week if term else None,
                venue=a.venue.name if a.venue else None,
                submission_mode=a.submission_mode,
                accepted_extensions=a.accepted_extensions,
                allow_late_until=a.allow_late_until,
                status=s.status if s and s.status != "draft" else None,
                submitted_at=s.submitted_at if s else None,
                mark=float(s.mark) if s and s.mark is not None and released else None,
                max_mark=float(a.max_mark),
                feedback=s.feedback_md if s and released else None,
            )
        )
    return Deadlines(week=term_info(term, now.date()).week if term else None, items=items)


# --- one assessment + submission ----------------------------------------------------------


class ReceiptFile(BaseModel):
    filename: str
    size_bytes: int
    sha256: str
    uploaded_at: datetime


class SubmissionOut(BaseModel):
    status: SubmissionStatus
    submitted_at: datetime | None
    note: str | None
    files: list[ReceiptFile]


class PendingUpload(BaseModel):
    id: uuid.UUID
    filename: str
    size_bytes: int
    received_bytes: int


class AssessmentOut(BaseModel):
    id: uuid.UUID
    kind: AssessmentKind
    title: str
    module_code: str
    due_at: datetime
    description: str | None
    lecturer: str | None
    submission_mode: SubmissionMode
    accepted_extensions: list[str] | None
    max_file_mb: int
    allow_late_until: datetime | None
    can_submit: bool
    reason: str | None  # why not, in plain words
    submission: SubmissionOut | None
    pending_upload: PendingUpload | None
    chunk_bytes: int = CHUNK_BYTES


async def _assessment(db: AsyncSession, student: Student, assessment_id: uuid.UUID) -> Assessment:
    a = await db.get(Assessment, assessment_id)
    allowed = {o.id for o in await current_offerings(db, student)}
    if a is None or a.offering_id not in allowed or a.published_at is None:
        raise HTTPException(404, "This assessment isn't available.")
    return a


async def _submission(db: AsyncSession, student: Student, a: Assessment) -> Submission | None:
    return (
        await db.execute(
            select(Submission).where(Submission.assessment_id == a.id, Submission.student_id == student.id)
        )
    ).scalar_one_or_none()


def _window(a: Assessment, sub: Submission | None, now: datetime) -> tuple[bool, str | None]:
    """Can the student upload now? (and if not, why)."""
    if a.submission_mode != "online":
        return False, "This one isn't handed in online." if a.submission_mode == "physical" else None
    if sub and sub.status in ("marked", "returned"):
        return False, "This work has been marked."
    if sub and sub.status in DONE and not a.allow_resubmission:
        return False, "You've already submitted this. Ask your lecturer if you need to change it."
    closes = a.allow_late_until or a.due_at
    if now > closes:
        return False, "Submissions for this have closed. Talk to your lecturer."
    if sub and sub.status in DONE and now > a.due_at:
        return False, "The deadline has passed, so you can't replace your submission."
    return True, None


def _submission_out(sub: Submission | None) -> SubmissionOut | None:
    """What the student has handed in; a draft isn't handed in yet."""
    return _submitted_out(sub) if sub is not None and sub.status != "draft" else None


def _submitted_out(sub: Submission) -> SubmissionOut:
    return SubmissionOut(
        status=sub.status,
        submitted_at=sub.submitted_at,
        note=sub.student_note,
        files=[
            ReceiptFile(
                filename=f.filename, size_bytes=f.size_bytes, sha256=f.sha256.hex(), uploaded_at=f.uploaded_at
            )
            for f in sub.files
        ],
    )


@router.get("/assessments/{assessment_id}")
async def assessment_detail(assessment_id: uuid.UUID, student: StudentDep, db: DbDep) -> AssessmentOut:
    a = await _assessment(db, student, assessment_id)
    sub = await _submission(db, student, a)
    can, reason = _window(a, sub, clock.now())
    pending = (
        (
            await db.execute(
                select(UploadSession)
                .where(
                    UploadSession.assessment_id == a.id,
                    UploadSession.student_id == student.id,
                    UploadSession.completed_at.is_(None),
                    UploadSession.cancelled_at.is_(None),
                )
                .order_by(UploadSession.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    lead = next((ol for ol in a.offering.lecturers if ol.role == "lead"), None)
    return AssessmentOut(
        id=a.id,
        kind=a.kind,
        title=a.title,
        module_code=a.offering.module.code,
        due_at=a.due_at,
        description=a.description_md,
        lecturer=lead.staff.short_name if lead else None,
        submission_mode=a.submission_mode,
        accepted_extensions=a.accepted_extensions,
        max_file_mb=a.max_file_mb,
        allow_late_until=a.allow_late_until,
        can_submit=can,
        reason=reason,
        submission=_submission_out(sub),
        pending_upload=PendingUpload(
            id=pending.id,
            filename=pending.filename,
            size_bytes=pending.size_bytes,
            received_bytes=pending.received_bytes,
        )
        if pending
        else None,
    )


# --- uploads --------------------------------------------------------------------------------


class UploadIn(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    size_bytes: int = Field(gt=0)
    mime_type: str = Field(default="application/octet-stream", max_length=200)


class UploadOut(BaseModel):
    id: uuid.UUID
    received_bytes: int
    size_bytes: int
    chunk_bytes: int = CHUNK_BYTES


def _safe_name(name: str) -> str:
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    return re.sub(r"[^\w.\- ]+", "_", name).strip() or "file"


def _ext(name: str) -> str:
    return ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""


def _chunk_prefix(upload_id: uuid.UUID) -> str:
    return f"uploads/{upload_id}/"


@router.post("/assessments/{assessment_id}/uploads", status_code=201)
async def start_upload(
    assessment_id: uuid.UUID,
    body: UploadIn,
    student: StudentDep,
    db: DbDep,
) -> UploadOut:
    a = await _assessment(db, student, assessment_id)
    can, reason = _window(a, await _submission(db, student, a), clock.now())
    if not can:
        raise HTTPException(409, reason or "You can't submit this online.")
    name = _safe_name(body.filename)
    if a.accepted_extensions and _ext(name) not in a.accepted_extensions:
        raise HTTPException(422, f"Upload a {' or '.join(a.accepted_extensions)} file.")
    if body.size_bytes > a.max_file_mb * 1_000_000:
        raise HTTPException(422, f"This file is too big. The limit is {a.max_file_mb} MB.")
    # One upload at a time per assessment: starting again replaces an unfinished one.
    for old in (
        await db.execute(
            select(UploadSession).where(
                UploadSession.assessment_id == a.id,
                UploadSession.student_id == student.id,
                UploadSession.completed_at.is_(None),
                UploadSession.cancelled_at.is_(None),
            )
        )
    ).scalars():
        old.cancelled_at = clock.now()
    up = UploadSession(
        assessment_id=a.id,
        student_id=student.id,
        filename=name,
        mime_type=body.mime_type,
        size_bytes=body.size_bytes,
    )
    db.add(up)
    await db.commit()
    return UploadOut(id=up.id, received_bytes=0, size_bytes=up.size_bytes)


async def _upload(db: AsyncSession, student: Student, upload_id: uuid.UUID) -> UploadSession:
    up = await db.get(UploadSession, upload_id)
    if up is None or up.student_id != student.id or up.cancelled_at is not None:
        raise HTTPException(404, "This upload isn't available. Start again.")
    return up


@router.get("/uploads/{upload_id}")
async def upload_status(upload_id: uuid.UUID, student: StudentDep, db: DbDep) -> UploadOut:
    up = await _upload(db, student, upload_id)
    return UploadOut(id=up.id, received_bytes=up.received_bytes, size_bytes=up.size_bytes)


@router.put("/uploads/{upload_id}")
async def upload_chunk(
    upload_id: uuid.UUID,
    request: Request,
    student: StudentDep,
    db: DbDep,
    offset: Annotated[int, Query(ge=0)],
) -> UploadOut:
    up = await _upload(db, student, upload_id)
    if up.completed_at:
        raise HTTPException(409, "This upload has already finished.")
    if offset != up.received_bytes:
        # The client is out of step (e.g. a retried chunk that did arrive). Tell it where to resume.
        raise HTTPException(
            409, detail={"message": "Resume from received_bytes", "received_bytes": up.received_bytes}
        )
    data = await request.body()
    if not data or len(data) > CHUNK_BYTES or offset + len(data) > up.size_bytes:
        raise HTTPException(422, "Bad chunk size.")
    await storage.put(
        get_settings().s3_bucket_content,
        f"{_chunk_prefix(up.id)}{offset:012d}",
        data,
        "application/octet-stream",
    )
    up.received_bytes = offset + len(data)
    up.updated_at = clock.now()
    await db.commit()
    return UploadOut(id=up.id, received_bytes=up.received_bytes, size_bytes=up.size_bytes)


class CompleteIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


@router.post("/uploads/{upload_id}/complete")
async def complete_upload(
    upload_id: uuid.UUID,
    body: CompleteIn,
    student: StudentDep,
    db: DbDep,
) -> SubmissionOut:
    up = await _upload(db, student, upload_id)
    if up.received_bytes != up.size_bytes:
        raise HTTPException(409, "The upload hasn't finished yet.")
    a = await _assessment(db, student, up.assessment_id)
    now = clock.now()
    sub = await _submission(db, student, a)
    can, reason = _window(a, sub, now)
    if not can:
        raise HTTPException(409, reason or "You can't submit this online.")

    bucket = get_settings().s3_bucket_content
    data = b"".join(
        [await storage.get(bucket, k) for k in await storage.list_keys(bucket, _chunk_prefix(up.id))]
    )
    if len(data) != up.size_bytes:
        raise HTTPException(409, "Part of the file is missing. Try again.")
    digest = hashlib.sha256(data).digest()
    key = f"submissions/{a.id}/{student.id}/{up.id}{_ext(up.filename)}"
    await storage.put(bucket, key, data, up.mime_type)
    await storage.delete_prefix(bucket, _chunk_prefix(up.id))

    if sub is None:
        sub = Submission(assessment_id=a.id, student_id=student.id)
        db.add(sub)
        await db.flush()
    else:  # resubmission replaces the earlier file
        await db.execute(delete(SubmissionFile).where(SubmissionFile.submission_id == sub.id))
    sub.status = "late" if now > a.due_at else "submitted"
    sub.submitted_at = now
    sub.student_note = (body.note or "").strip() or None
    db.add(
        SubmissionFile(
            submission_id=sub.id,
            object_key=key,
            filename=up.filename,
            mime_type=up.mime_type,
            size_bytes=up.size_bytes,
            sha256=digest,
            uploaded_at=now,
        )
    )
    up.completed_at = now
    await db.commit()
    await db.refresh(sub, ["files"])
    return _submitted_out(sub)


@router.delete("/uploads/{upload_id}", status_code=204)
async def cancel_upload(upload_id: uuid.UUID, student: StudentDep, db: DbDep) -> None:
    up = await _upload(db, student, upload_id)
    if up.completed_at is None:
        up.cancelled_at = clock.now()
        await db.commit()
        await storage.delete_prefix(get_settings().s3_bucket_content, _chunk_prefix(up.id))
