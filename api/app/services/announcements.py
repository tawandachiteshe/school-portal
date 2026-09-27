"""Announcement visibility (SQL function announcements_for_user) and the words around it."""

import uuid
from datetime import date

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Announcement, AnnouncementRead, AnnouncementTarget, Intake, ModuleOffering, Programme


async def visible(db: AsyncSession, user_id: uuid.UUID) -> list[Announcement]:
    """Pinned first, then newest."""
    stmt = (
        select(Announcement)
        .from_statement(text("SELECT * FROM announcements_for_user(:u)"))
        .params(u=user_id)
    )
    rows = list((await db.execute(stmt)).scalars())
    rows.sort(key=lambda a: (not a.is_pinned, -a.publish_at.timestamp()))
    return rows


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
    return "; ".join(parts)


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
