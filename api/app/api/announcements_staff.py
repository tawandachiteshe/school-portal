"""Staff announcements (design/AnnouncementCompose): the list every staff member sees, and writing,
scheduling and publishing for Student Affairs and administrators."""

import uuid
from datetime import datetime
from enum import StrEnum

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, require_role
from app.db import get_db
from app.models import Announcement, AnnouncementRead, AnnouncementTarget, Person, Programme, Staff
from app.services import announcements as ann
from app.services import clock

router = APIRouter(prefix="/staff/announcements", tags=["staff announcements"])
STAFF = ("lecturer", "admissions", "registry", "librarian", "admin", "student_affairs", "accounts")
WRITERS = ("student_affairs", "admin")
staff = require_role(*STAFF)
writer = require_role(*WRITERS)

TITLE_FITS = 90  # design: "Titles over 90 characters get cut off on small phones."
SMS_MAX = 160


class AudienceKind(StrEnum):
    everyone = "everyone"
    students = "students"
    groups = "groups"


class AnnouncementStatus(StrEnum):
    draft = "draft"
    scheduled = "scheduled"
    published = "published"
    expired = "expired"


class PublishAction(StrEnum):
    draft = "draft"
    publish = "publish"
    schedule = "schedule"


class AudienceGroup(BaseModel):
    """Students of one programme (or all), in one year (or all). 'Year 1 · all programmes'."""

    programme_id: uuid.UUID | None = None
    year: int | None = Field(default=None, ge=1, le=6)


class Audience(BaseModel):
    kind: AudienceKind
    groups: list[AudienceGroup] = []


class AnnouncementIn(BaseModel):
    title: str = Field(max_length=200)
    body: str = Field(max_length=10_000)
    audience: Audience
    pinned: bool = False
    pinned_until: datetime | None = None
    sms_text: str | None = Field(default=None, max_length=SMS_MAX)
    action: PublishAction
    publish_at: datetime | None = None  # for action=schedule


class Reach(BaseModel):
    students: int
    staff: int
    phones: int


class StaffAnnouncement(BaseModel):
    id: uuid.UUID
    title: str
    from_label: str | None
    status: AnnouncementStatus
    publish_at: datetime
    updated_at: datetime
    audience: str
    pinned: bool
    sms: bool
    reads: int


class AnnouncementForm(BaseModel):
    id: uuid.UUID
    title: str
    body: str
    audience: Audience
    pinned: bool
    pinned_until: datetime | None
    sms_text: str | None
    status: AnnouncementStatus
    publish_at: datetime
    updated_at: datetime


class ProgrammeOption(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    years: int


class ComposeOptions(BaseModel):
    from_label: str
    programmes: list[ProgrammeOption]
    title_fits: int
    sms_max: int


def _targets(a: Audience) -> list[AnnouncementTarget]:
    if a.kind == AudienceKind.everyone:
        return [AnnouncementTarget()]
    if a.kind == AudienceKind.students:
        return [AnnouncementTarget(role="student")]
    out: list[AnnouncementTarget] = []
    for g in a.groups:
        # term_number is the term of study; a year is its two terms.
        terms = [g.year * 2 - 1, g.year * 2] if g.year else [None]
        out += [AnnouncementTarget(role="student", programme_id=g.programme_id, term_number=t) for t in terms]
    return out


def _audience(targets: list[AnnouncementTarget]) -> Audience:
    if any(not any((t.role, t.programme_id, t.term_number, t.offering_id, t.intake_id)) for t in targets):
        return Audience(kind=AudienceKind.everyone)
    if (
        len(targets) == 1
        and targets[0].role == "student"
        and not targets[0].programme_id
        and not targets[0].term_number
    ):
        return Audience(kind=AudienceKind.students)
    groups = dict.fromkeys(
        (t.programme_id, (t.term_number + 1) // 2 if t.term_number else None) for t in targets
    )
    return Audience(
        kind=AudienceKind.groups, groups=[AudienceGroup(programme_id=p, year=y) for p, y in groups]
    )


def _status(a: Announcement, now: datetime) -> AnnouncementStatus:
    if a.is_draft:
        return AnnouncementStatus.draft
    if a.publish_at > now:
        return AnnouncementStatus.scheduled
    if a.expires_at and a.expires_at <= now:
        return AnnouncementStatus.expired
    return AnnouncementStatus.published


async def _from_label(db: AsyncSession, cu: CurrentUser) -> str:
    st = (
        await db.execute(
            select(Staff).join(Person, Person.id == Staff.person_id).where(Person.user_id == cu.user.id)
        )
    ).scalar_one_or_none()
    if st and st.department:
        return st.department.name
    return "Student Affairs" if "student_affairs" in cu.roles else "Administration"


@router.get("")
async def list_staff_announcements(
    cu: CurrentUser = Depends(staff), db: AsyncSession = Depends(get_db)
) -> list[StaffAnnouncement]:
    """Newest first. Drafts only for the people who can write announcements."""
    q = select(Announcement).order_by(Announcement.publish_at.desc())
    if not cu.roles & set(WRITERS):
        q = q.where(~Announcement.is_draft)
    rows = (await db.execute(q)).scalars().all()
    reads = dict(
        (
            await db.execute(
                select(AnnouncementRead.announcement_id, func.count()).group_by(
                    AnnouncementRead.announcement_id
                )
            )
        ).all()
    )
    now = clock.now()
    return [
        StaffAnnouncement(
            id=a.id,
            title=a.title,
            from_label=a.from_label,
            status=_status(a, now),
            publish_at=a.publish_at,
            updated_at=a.updated_at,
            audience=await ann.describe_audience(db, a.targets),
            pinned=ann.pinned_now(a, now),
            sms=bool(a.sms_text),
            reads=reads.get(a.id, 0),
        )
        for a in rows
    ]


@router.get("/options")
async def compose_options(
    cu: CurrentUser = Depends(writer), db: AsyncSession = Depends(get_db)
) -> ComposeOptions:
    progs = (await db.execute(select(Programme).order_by(Programme.name))).scalars().all()
    return ComposeOptions(
        from_label=await _from_label(db, cu),
        programmes=[
            ProgrammeOption(id=p.id, code=p.code, name=p.name, years=(p.duration_terms + 1) // 2)
            for p in progs
        ],
        title_fits=TITLE_FITS,
        sms_max=SMS_MAX,
    )


@router.post("/reach")
async def audience_reach(
    body: Audience, _: CurrentUser = Depends(writer), db: AsyncSession = Depends(get_db)
) -> Reach:
    students, staff_n, phones = await ann.reach(db, _targets(body))
    return Reach(students=students, staff=staff_n, phones=phones)


async def _get(db: AsyncSession, announcement_id: uuid.UUID) -> Announcement:
    a = await db.get(Announcement, announcement_id)
    if a is None:
        raise HTTPException(404, "That announcement doesn't exist.")
    return a


def _form(a: Announcement) -> AnnouncementForm:
    return AnnouncementForm(
        id=a.id,
        title=a.title,
        body=a.body_md,
        audience=_audience(a.targets),
        pinned=a.is_pinned,
        pinned_until=a.pinned_until,
        sms_text=a.sms_text,
        status=_status(a, clock.now()),
        publish_at=a.publish_at,
        updated_at=a.updated_at,
    )


@router.get("/{announcement_id}")
async def get_staff_announcement(
    announcement_id: uuid.UUID, _: CurrentUser = Depends(writer), db: AsyncSession = Depends(get_db)
) -> AnnouncementForm:
    return _form(await _get(db, announcement_id))


def _check(body: AnnouncementIn, now: datetime) -> datetime:
    """Validates what publishing needs; drafts may be incomplete. Returns the publish time."""
    if body.action == PublishAction.draft:
        return body.publish_at if body.publish_at and body.publish_at > now else now
    if not body.title.strip():
        raise HTTPException(422, "Add a title.")
    if not body.body.strip():
        raise HTTPException(422, "Add a message.")
    if body.audience.kind == AudienceKind.groups and not body.audience.groups:
        raise HTTPException(422, "Choose at least one group, or pick all students.")
    if body.sms_text is not None and not body.sms_text.strip():
        raise HTTPException(422, "Write the SMS text, or turn SMS off.")
    at = now
    if body.action == PublishAction.schedule:
        if not body.publish_at or body.publish_at <= now:
            raise HTTPException(422, "Choose a time in the future to publish.")
        at = body.publish_at
    if body.pinned and body.pinned_until and body.pinned_until <= at:
        raise HTTPException(422, "The pin has to end after the announcement is published.")
    return at


async def _save(db: AsyncSession, a: Announcement, body: AnnouncementIn) -> AnnouncementForm:
    now = clock.now()
    if a.dispatched_at and body.action != PublishAction.publish:
        raise HTTPException(409, "This announcement is already published.")
    at = _check(body, now)
    a.title = body.title.strip()
    a.body_md = body.body.strip()
    a.is_pinned = body.pinned
    a.pinned_until = body.pinned_until if body.pinned else None
    a.sms_text = body.sms_text.strip() if body.sms_text else None
    a.is_draft = body.action == PublishAction.draft
    if not a.dispatched_at:
        a.publish_at = at
        a.targets = _targets(body.audience)
    a.updated_at = now
    await db.commit()
    if body.action == PublishAction.publish and not a.dispatched_at:
        await ann.dispatch_due(db)
    await db.refresh(a)
    return _form(a)


@router.post("")
async def create_announcement(
    body: AnnouncementIn, cu: CurrentUser = Depends(writer), db: AsyncSession = Depends(get_db)
) -> AnnouncementForm:
    a = Announcement(author_id=cu.user.id, from_label=await _from_label(db, cu), title="", body_md="")
    db.add(a)
    return await _save(db, a, body)


@router.put("/{announcement_id}")
async def update_announcement(
    announcement_id: uuid.UUID,
    body: AnnouncementIn,
    _: CurrentUser = Depends(writer),
    db: AsyncSession = Depends(get_db),
) -> AnnouncementForm:
    return await _save(db, await _get(db, announcement_id), body)


class Deleted(BaseModel):
    deleted: bool


@router.delete("/{announcement_id}")
async def delete_announcement(
    announcement_id: uuid.UUID, _: CurrentUser = Depends(writer), db: AsyncSession = Depends(get_db)
) -> Deleted:
    a = await _get(db, announcement_id)
    if a.dispatched_at:
        raise HTTPException(409, "Published announcements can't be deleted.")
    await db.delete(a)
    await db.commit()
    return Deleted(deleted=True)
