"""Announcement visibility (SQL function announcements_for_user) and the words around it."""

import uuid
from datetime import date, datetime

from sqlalchemy import and_, exists, false, func, or_, select, text, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Announcement,
    AnnouncementRead,
    AnnouncementTarget,
    Enrolment,
    Intake,
    ModuleOffering,
    Notification,
    NotificationDelivery,
    Person,
    Programme,
    Student,
    User,
    UserRole,
)
from app.services import clock


def pinned_now(a: Announcement, now: datetime | None = None) -> bool:
    return a.is_pinned and (a.pinned_until is None or a.pinned_until > (now or clock.now()))


async def visible(db: AsyncSession, user_id: uuid.UUID) -> list[Announcement]:
    """Pinned first, then newest."""
    stmt = (
        select(Announcement)
        .from_statement(text("SELECT * FROM announcements_for_user(:u)"))
        .params(u=user_id)
    )
    rows = list((await db.execute(stmt)).scalars())
    now = clock.now()
    rows.sort(key=lambda a: (not pinned_now(a, now), -a.publish_at.timestamp()))
    return rows


# --- audience -----------------------------------------------------------------------------------
# Mirrors announcements_for_user(): each target is an OR-ed rule, its non-NULL columns AND-ed.


def _matches(t: AnnouncementTarget):
    conds = []
    if t.role:
        conds.append(exists().where(UserRole.user_id == User.id, UserRole.role == t.role))
    if t.programme_id or t.term_number or t.intake_id or t.offering_id:
        stu = [Student.person_id == Person.id, Person.user_id == User.id, Student.status == "active"]
        if t.programme_id:
            stu.append(Student.programme_id == t.programme_id)
        if t.term_number:
            stu.append(Student.current_term_number == t.term_number)
        if t.intake_id:
            stu.append(Student.intake_id == t.intake_id)
        if t.offering_id:
            stu.append(
                exists().where(
                    Enrolment.student_id == Student.id,
                    Enrolment.offering_id == t.offering_id,
                    Enrolment.dropped_at.is_(None),
                )
            )
        conds.append(exists().where(*stu))
    return and_(true(), *conds)


def audience_filter(targets: list[AnnouncementTarget]):
    return or_(false(), *(_matches(t) for t in targets))


async def reach(db: AsyncSession, targets: list[AnnouncementTarget]) -> tuple[int, int, int]:
    """(students, staff, people with a phone) the targets reach among active accounts."""
    if not targets:
        return 0, 0, 0
    base = select(User.id).where(User.is_active, audience_filter(targets)).subquery()
    is_student = exists().where(UserRole.user_id == base.c.id, UserRole.role == "student")
    is_staff = exists().where(UserRole.user_id == base.c.id, UserRole.role.not_in(["student", "applicant"]))
    students = await db.scalar(select(func.count()).select_from(base).where(is_student)) or 0
    staff = await db.scalar(select(func.count()).select_from(base).where(is_staff)) or 0
    phones = (
        await db.scalar(
            select(func.count())
            .select_from(base)
            .join(User, User.id == base.c.id)
            .where(User.phone.is_not(None))
        )
        or 0
    )
    return students, staff, phones


async def dispatch_due(db: AsyncSession) -> int:
    """Notify the audience of every announcement whose publish time has come, once.
    An SMS is queued for people with a phone when the announcement has SMS text; the SMS worker
    sends it once a provider is configured (SMS_PROVIDER). Returns how many were dispatched."""
    now = clock.now()
    due = (
        (
            await db.execute(
                select(Announcement)
                .where(
                    ~Announcement.is_draft,
                    Announcement.dispatched_at.is_(None),
                    Announcement.publish_at <= now,
                )
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    for a in due:
        users = (
            (await db.execute(select(User).where(User.is_active, audience_filter(a.targets)))).scalars().all()
        )
        for u in users:
            n = Notification(
                user_id=u.id,
                category="announcement",
                title=a.title,
                body=a.sms_text,
                link=f"/announcements/{a.id}",
                dedupe_key=f"announcement:{a.id}",
            )
            db.add(n)
            if a.sms_text and u.phone:
                db.add(NotificationDelivery(notification=n, channel="sms", status="queued"))
        a.dispatched_at = now
    await db.commit()
    return len(due)


async def read_ids(db: AsyncSession, user_id: uuid.UUID, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not ids:
        return set()
    rows = await db.execute(
        select(AnnouncementRead.announcement_id).where(
            AnnouncementRead.user_id == user_id, AnnouncementRead.announcement_id.in_(ids)
        )
    )
    return set(rows.scalars())


ROLE_AUDIENCE = {
    "student": "all students",
    "lecturer": "lecturers",
    "applicant": "applicants",
    "admissions": "admissions staff",
    "librarian": "library staff",
    "registry": "registry staff",
    "student_affairs": "Student Affairs",
    "admin": "administrators",
}


async def describe_audience(db: AsyncSession, targets: list[AnnouncementTarget]) -> str:
    """'all students and staff', 'Year 1 · Diploma in Information Technology', …"""
    if any(not any((t.role, t.programme_id, t.term_number, t.offering_id, t.intake_id)) for t in targets):
        return "all students and staff"
    parts: list[str] = []
    for t in targets:
        bits: list[str] = []
        if t.term_number:
            bits.append(f"Year {(t.term_number + 1) // 2}")
        if t.programme_id:
            p = await db.get(Programme, t.programme_id)
            bits.append(p.name if p else "")
        if t.offering_id:
            o = await db.get(ModuleOffering, t.offering_id)
            bits.append(f"{o.module.code} {o.class_group}" if o else "")
        if t.intake_id:
            i = await db.get(Intake, t.intake_id)
            bits.append(i.name if i else "")
        if t.role and not bits:
            bits.append(ROLE_AUDIENCE.get(t.role, t.role))
        elif t.role == "student" and t.term_number and not t.programme_id:
            bits.append("all programmes")
        parts.append(" · ".join(b for b in bits if b))
    return "; ".join(dict.fromkeys(parts))  # a year is two term rules with the same words


def day_phrase(d: date, today: date) -> str:
    """'today', 'tomorrow', 'on Friday' (within a week), else 'on 12 March'."""
    delta = (d - today).days
    if delta == 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if 1 < delta < 7:
        return f"on {d.strftime('%A')}"
    return f"on {d.day} {d.strftime('%B')}"
