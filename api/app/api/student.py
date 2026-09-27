"""Student-facing endpoints: dashboard and announcements."""

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types import AssessmentKind, ClassKind, SubmissionMode
from app.auth.deps import CurrentUser, current_user
from app.config import get_settings
from app.db import get_db
from app.models import (
    AnnouncementRead,
    Assessment,
    CourseMaterial,
    LibraryLoan,
    Student,
    Submission,
    Venue,
)
from app.services import announcements as ann
from app.services import clock, timetable
from app.services.students import current_offerings, current_student, offering_ids

router = APIRouter(prefix="/student", tags=["student"])


class TodayClass(BaseModel):
    module_code: str
    module_name: str
    kind: ClassKind
    starts_at: datetime
    ends_at: datetime
    venue: str | None
    lecturer: str | None
    cancelled: bool
    change_reason: str | None
    assessment_title: str | None


class DueItem(BaseModel):
    id: uuid.UUID
    kind: AssessmentKind
    title: str
    module_code: str
    due_at: datetime
    venue: str | None
    submission_mode: SubmissionMode
    submitted: bool


class AnnouncementItem(BaseModel):
    id: uuid.UUID
    title: str
    from_label: str | None
    publish_at: datetime
    is_pinned: bool
    read: bool


class Announcements(BaseModel):
    total: int
    unread: int
    items: list[AnnouncementItem]


class NoteItem(BaseModel):
    id: uuid.UUID
    title: str
    module_code: str
    week: int | None
    mime_type: str | None
    size_bytes: int | None
    published_at: datetime


class LoanItem(BaseModel):
    id: uuid.UUID
    title: str
    authors: list[str]
    due_at: datetime
    renewals_left: int
    overdue: bool


class ResultsStatus(BaseModel):
    term_name: str | None
    published: bool


class DashboardNextClass(BaseModel):
    module_code: str
    starts_at: datetime
    venue: str | None


class Dashboard(BaseModel):
    today: list[TodayClass]
    next_class: DashboardNextClass | None  # set when there are no classes today
    due: list[DueItem]
    announcements: Announcements
    notes: list[NoteItem]
    loans: list[LoanItem]
    results: ResultsStatus


async def _announcements(db: AsyncSession, user_id: uuid.UUID, limit: int | None) -> Announcements:
    rows = await ann.visible(db, user_id)
    read = await ann.read_ids(db, user_id, [a.id for a in rows])
    items = [
        AnnouncementItem(
            id=a.id,
            title=a.title,
            from_label=a.from_label,
            publish_at=a.publish_at,
            is_pinned=ann.pinned_now(a),
            read=a.id in read,
        )
        for a in rows
    ]
    return Announcements(
        total=len(items), unread=sum(not i.read for i in items), items=items[:limit] if limit else items
    )


def _loan_items(loans: list[LibraryLoan], max_renewals: int) -> list[LoanItem]:
    now = clock.now()
    return [
        LoanItem(
            id=loan.id,
            title=loan.copy.item.title,
            authors=loan.copy.item.authors,
            due_at=loan.due_at,
            renewals_left=max(0, max_renewals - loan.renewals),
            overdue=loan.due_at < now,
        )
        for loan in sorted(loans, key=lambda x: x.due_at)
    ]


@router.get("/dashboard")
async def dashboard(
    cu: CurrentUser = Depends(current_user),
    student: Student = Depends(current_student),
    db: AsyncSession = Depends(get_db),
) -> Dashboard:
    now = clock.now()
    offerings = await current_offerings(db, student)
    ids = offering_ids(offerings)

    today = await timetable.occurrences(db, ids, [now.date()])
    next_class = None
    if not today:
        upcoming = await timetable.occurrences(db, ids, [now.date() + timedelta(days=i) for i in range(1, 8)])
        nxt = next((o for o in upcoming if not o.cancelled), None)
        if nxt:
            next_class = DashboardNextClass(
                module_code=nxt.module_code, starts_at=nxt.starts_at, venue=nxt.venue
            )

    assessments = (
        (
            await db.execute(
                select(Assessment)
                .where(
                    Assessment.offering_id.in_(ids),
                    Assessment.published_at.is_not(None),
                    Assessment.due_at >= now,
                    Assessment.due_at < now + timedelta(days=7),
                )
                .order_by(Assessment.due_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    submitted = set(
        (
            await db.execute(
                select(Submission.assessment_id).where(
                    Submission.student_id == student.id,
                    Submission.assessment_id.in_([a.id for a in assessments]),
                    Submission.status.in_(["submitted", "late", "marked", "returned"]),
                )
            )
        ).scalars()
    )
    venues = {v.id: v.name for v in (await db.execute(select(Venue))).scalars()}

    notes = (
        (
            await db.execute(
                select(CourseMaterial)
                .where(
                    CourseMaterial.offering_id.in_(ids),
                    CourseMaterial.published_at.is_not(None),
                    CourseMaterial.published_at <= now,
                )
                .order_by(CourseMaterial.published_at.desc())
                .limit(3)
            )
        )
        .unique()
        .scalars()
        .all()
    )

    loans = (
        (
            await db.execute(
                select(LibraryLoan).where(
                    LibraryLoan.person_id == student.person_id, LibraryLoan.returned_at.is_(None)
                )
            )
        )
        .unique()
        .scalars()
        .all()
    )

    term = offerings[0].term if offerings else None
    published = bool(offerings) and all(
        o.results_published_at is not None and o.results_published_at <= now for o in offerings
    )

    return Dashboard(
        today=[
            TodayClass(
                module_code=o.module_code,
                module_name=o.module_name,
                kind=o.kind,
                starts_at=o.starts_at,
                ends_at=o.ends_at,
                venue=o.venue,
                lecturer=o.lecturer,
                cancelled=o.cancelled,
                change_reason=o.change_reason,
                assessment_title=o.assessment_title,
            )
            for o in today
        ],
        next_class=next_class,
        due=[
            DueItem(
                id=a.id,
                kind=a.kind,
                title=a.title,
                module_code=a.offering.module.code,
                due_at=a.due_at,
                venue=venues.get(a.venue_id) if a.venue_id else None,
                submission_mode=a.submission_mode,
                submitted=a.id in submitted,
            )
            for a in assessments
        ],
        announcements=await _announcements(db, cu.user.id, 3),
        notes=[
            NoteItem(
                id=n.id,
                title=n.title,
                module_code=n.offering.module.code,
                week=n.week,
                mime_type=n.mime_type,
                size_bytes=n.size_bytes,
                published_at=n.published_at,
            )
            for n in notes
            if n.published_at
        ],
        loans=_loan_items(list(loans), get_settings().library_max_renewals),
        results=ResultsStatus(term_name=term.name if term else None, published=published),
    )


# --- announcements -----------------------------------------------------------------------


class AnnouncementDetail(BaseModel):
    id: uuid.UUID
    title: str
    body_md: str
    from_label: str | None
    publish_at: datetime
    is_pinned: bool
    audience: str
    contact_line: str | None
    affects: str | None  # "None of your classes are in Lab 3 on Friday."
    affects_you: bool | None


@router.get("/announcements")
async def list_announcements(
    cu: CurrentUser = Depends(current_user),
    _: Student = Depends(current_student),
    db: AsyncSession = Depends(get_db),
) -> Announcements:
    return await _announcements(db, cu.user.id, None)


@router.get("/announcements/{announcement_id}")
async def announcement_detail(
    announcement_id: uuid.UUID,
    cu: CurrentUser = Depends(current_user),
    student: Student = Depends(current_student),
    db: AsyncSession = Depends(get_db),
) -> AnnouncementDetail:
    a = next((x for x in await ann.visible(db, cu.user.id) if x.id == announcement_id), None)
    if a is None:
        raise HTTPException(404, "This announcement isn't available.")
    # Opening it marks it read.
    await db.execute(
        insert(AnnouncementRead)
        .values(announcement_id=a.id, user_id=cu.user.id)
        .on_conflict_do_nothing(index_elements=["announcement_id", "user_id"])
    )
    await db.commit()

    affects = affects_you = None
    if a.affects_venue_id and a.affects_on:
        venue = await db.get(Venue, a.affects_venue_id)
        classes = await timetable.occurrences(
            db, offering_ids(await current_offerings(db, student)), [a.affects_on]
        )
        hit = [c for c in classes if c.venue_id == a.affects_venue_id and not c.cancelled]
        when = ann.day_phrase(a.affects_on, clock.today())
        vname = venue.name if venue else "that room"
        if hit:
            codes = ", ".join(dict.fromkeys(c.module_code for c in hit))
            noun = "class is" if len(hit) == 1 else "classes are"
            affects, affects_you = f"Your {codes} {noun} in {vname} {when}.", True
        else:
            affects, affects_you = f"None of your classes are in {vname} {when}.", False

    return AnnouncementDetail(
        id=a.id,
        title=a.title,
        body_md=a.body_md,
        from_label=a.from_label,
        publish_at=a.publish_at,
        is_pinned=ann.pinned_now(a),
        audience=await ann.describe_audience(db, a.targets),
        contact_line=a.contact_line,
        affects=affects,
        affects_you=affects_you,
    )


# --- search (desktop top bar: "Search modules, notes, announcements") -------------------------


class ModuleHit(BaseModel):
    code: str
    name: str


class NoteHit(BaseModel):
    id: uuid.UUID
    title: str
    module_code: str
    week: int | None
    mime_type: str | None
    size_bytes: int | None


class AnnouncementHit(BaseModel):
    id: uuid.UUID
    title: str
    from_label: str | None
    publish_at: datetime


class StudentSearchResults(BaseModel):
    query: str
    modules: list[ModuleHit]
    notes: list[NoteHit]
    announcements: list[AnnouncementHit]


@router.get("/search")
async def search_student(
    q: str = Query(min_length=2, max_length=100),
    cu: CurrentUser = Depends(current_user),
    student: Student = Depends(current_student),
    db: AsyncSession = Depends(get_db),
) -> StudentSearchResults:
    term = q.strip().lower()
    now = clock.now()
    offerings = await current_offerings(db, student)
    modules = [
        ModuleHit(code=o.module.code, name=o.module.name)
        for o in offerings
        if term in o.module.code.lower() or term in o.module.name.lower()
    ]
    notes = (
        (
            await db.execute(
                select(CourseMaterial)
                .where(
                    CourseMaterial.offering_id.in_([o.id for o in offerings]),
                    CourseMaterial.published_at.is_not(None),
                    CourseMaterial.published_at <= now,
                    or_(
                        CourseMaterial.title.ilike(f"%{term}%"),
                        CourseMaterial.topic.ilike(f"%{term}%"),
                        CourseMaterial.offering_id.in_(
                            [o.id for o in offerings if o.module.code.lower() == term]
                        ),
                    ),
                )
                .order_by(CourseMaterial.published_at.desc())
                .limit(20)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    anns = [
        a
        for a in await ann.visible(db, cu.user.id)
        if term in a.title.lower() or term in a.body_md.lower() or term in (a.from_label or "").lower()
    ][:10]
    return StudentSearchResults(
        query=q.strip(),
        modules=modules,
        notes=[
            NoteHit(
                id=n.id,
                title=n.title,
                module_code=n.offering.module.code,
                week=n.week,
                mime_type=n.mime_type,
                size_bytes=n.size_bytes,
            )
            for n in notes
        ],
        announcements=[
            AnnouncementHit(id=a.id, title=a.title, from_label=a.from_label, publish_at=a.publish_at)
            for a in anns
        ],
    )
