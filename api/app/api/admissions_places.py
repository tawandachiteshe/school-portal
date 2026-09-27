"""Intake places (no design): how many places each programme has in the intake, against offers
made and accepted. Admissions sets the numbers; until then a programme shows "Not set"."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, require_role
from app.db import get_db
from app.models import Application, Intake, IntakePlace, Programme
from app.services import clock

router = APIRouter(prefix="/staff/admissions/places", tags=["admissions"])
officer = require_role("admissions", "admin")


class ProgrammePlaces(BaseModel):
    programme_id: uuid.UUID
    code: str
    name: str
    places: int | None  # None: not set yet
    offered: int  # offers made (accepted status), including ones the applicant then declined
    accepted: int  # offers the applicant accepted
    declined: int
    in_queue: int  # submitted, in review or waiting for information
    remaining: int | None  # places minus offers still standing


class IntakePlaces(BaseModel):
    intake: str | None
    closes_at: datetime | None
    programmes: list[ProgrammePlaces]


async def _intake(db: AsyncSession) -> Intake | None:
    now = clock.now()
    upcoming = (
        await db.execute(select(Intake).where(Intake.closes_at > now).order_by(Intake.opens_at).limit(1))
    ).scalar_one_or_none()
    return (
        upcoming
        or (await db.execute(select(Intake).order_by(Intake.closes_at.desc()).limit(1))).scalar_one_or_none()
    )


async def _places(db: AsyncSession) -> IntakePlaces:
    intake = await _intake(db)
    programmes = (
        (await db.execute(select(Programme).order_by(Programme.level.desc(), Programme.name))).scalars().all()
    )
    if intake is None:
        return IntakePlaces(intake=None, closes_at=None, programmes=[])
    set_places = {
        p.programme_id: p.places
        for p in (await db.execute(select(IntakePlace).where(IntakePlace.intake_id == intake.id))).scalars()
    }
    counts = {
        row.programme_id: row
        for row in (
            await db.execute(
                select(
                    Application.programme_id,
                    func.count().filter(Application.status == "accepted").label("offered"),
                    func.count().filter(Application.offer_accepted_at.is_not(None)).label("accepted"),
                    func.count().filter(Application.offer_declined_at.is_not(None)).label("declined"),
                    func.count()
                    .filter(Application.status.in_(("submitted", "in_review", "more_info")))
                    .label("in_queue"),
                )
                .where(Application.intake_id == intake.id)
                .group_by(Application.programme_id)
            )
        ).all()
    }
    out = []
    for p in programmes:
        if not p.is_accepting_applications and p.id not in set_places and p.id not in counts:
            continue
        c = counts.get(p.id)
        offered, accepted, declined, queue = (
            (c.offered, c.accepted, c.declined, c.in_queue) if c else (0, 0, 0, 0)
        )
        places = set_places.get(p.id)
        out.append(
            ProgrammePlaces(
                programme_id=p.id,
                code=p.code,
                name=p.name,
                places=places,
                offered=offered,
                accepted=accepted,
                declined=declined,
                in_queue=queue,
                remaining=None if places is None else places - (offered - declined),
            )
        )
    return IntakePlaces(intake=intake.name, closes_at=intake.closes_at, programmes=out)


@router.get("")
async def intake_places(
    _: CurrentUser = Depends(officer), db: AsyncSession = Depends(get_db)
) -> IntakePlaces:
    return await _places(db)


class PlacesIn(BaseModel):
    places: int = Field(ge=0, le=10_000)


@router.put("/{programme_id}")
async def set_intake_places(
    programme_id: uuid.UUID,
    body: PlacesIn,
    cu: CurrentUser = Depends(officer),
    db: AsyncSession = Depends(get_db),
) -> IntakePlaces:
    intake = await _intake(db)
    if intake is None or await db.get(Programme, programme_id) is None:
        raise HTTPException(404, "Programme or intake not found")
    row = await db.get(IntakePlace, (intake.id, programme_id))
    if row is None:
        db.add(
            IntakePlace(
                intake_id=intake.id, programme_id=programme_id, places=body.places, updated_by=cu.user.id
            )
        )
    else:
        row.places, row.updated_by, row.updated_at = body.places, cu.user.id, clock.now()
    await db.commit()
    return await _places(db)
