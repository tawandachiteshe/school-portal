"""A student's (or lecturer's) classes on given dates: weekly slots plus one-off exceptions."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Assessment, TimetableException, TimetableSlot, Venue
from app.services.clock import at


@dataclass
class ClassOccurrence:
    slot_id: uuid.UUID
    offering_id: uuid.UUID
    module_code: str
    module_name: str
    class_group: str
    kind: str
    starts_at: datetime
    ends_at: datetime
    venue: str | None
    venue_id: uuid.UUID | None
    lecturer: str | None
    cancelled: bool
    change_reason: str | None
    assessment_id: uuid.UUID | None = None
    assessment_title: str | None = None


async def occurrences(
    db: AsyncSession, offering_ids: list[uuid.UUID], days: list[date]
) -> list[ClassOccurrence]:
    if not offering_ids or not days:
        return []
    slots = (
        (
            await db.execute(
                select(TimetableSlot).where(
                    TimetableSlot.offering_id.in_(offering_ids),
                    TimetableSlot.day_of_week.in_({d.isoweekday() for d in days}),
                )
            )
        )
        .unique()
        .scalars()
        .all()
    )
    exceptions = {
        (e.slot_id, e.on_date): e
        for e in (
            await db.execute(
                select(TimetableException).where(
                    TimetableException.slot_id.in_([s.id for s in slots]),
                    TimetableException.on_date.in_(days),
                )
            )
        ).scalars()
    }
    venues = {v.id: v.name for v in (await db.execute(select(Venue))).scalars()}

    out: list[ClassOccurrence] = []
    for d in days:
        for s in slots:
            if s.day_of_week != d.isoweekday():
                continue
            if (s.valid_from and d < s.valid_from) or (s.valid_to and d > s.valid_to):
                continue
            ex = exceptions.get((s.id, d))
            start, end, venue_id = s.starts_at, s.ends_at, s.venue_id
            if ex:
                start = ex.new_starts_at or start
                end = ex.new_ends_at or end
                venue_id = ex.new_venue_id or venue_id
            lead = next((ol for ol in s.offering.lecturers if ol.role == "lead"), None)
            out.append(
                ClassOccurrence(
                    slot_id=s.id,
                    offering_id=s.offering_id,
                    module_code=s.offering.module.code,
                    module_name=s.offering.module.name,
                    class_group=s.offering.class_group,
                    kind=s.kind,
                    starts_at=at(d, start),
                    ends_at=at(d, end),
                    venue=venues.get(venue_id) if venue_id else None,
                    venue_id=venue_id,
                    lecturer=lead.staff.short_name if lead else None,
                    cancelled=bool(ex and ex.cancelled),
                    change_reason=ex.reason if ex else None,
                )
            )
    out.sort(key=lambda o: o.starts_at)
    await _attach_assessments(db, out)
    return out


async def _attach_assessments(db: AsyncSession, occ: list[ClassOccurrence]) -> None:
    """A test that starts during a class replaces its label ("Test 1 · Lab 3")."""
    if not occ:
        return
    conds = [
        and_(
            Assessment.offering_id == o.offering_id,
            Assessment.due_at >= o.starts_at,
            Assessment.due_at < o.ends_at,
        )
        for o in occ
    ]
    tests = (
        (
            await db.execute(
                select(Assessment).where(
                    Assessment.published_at.is_not(None),
                    Assessment.kind.in_(["test", "exam", "practical"]),
                    or_(*conds),
                )
            )
        )
        .unique()
        .scalars()
        .all()
    )
    for o in occ:
        for a in tests:
            if a.offering_id == o.offering_id and o.starts_at <= a.due_at < o.ends_at:
                o.assessment_id, o.assessment_title = a.id, a.title
