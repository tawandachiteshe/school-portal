"""The applicant's own application (design/ProgrammeMobile, ProgrammeDesktop, Status, OfferReceived)."""

import uuid
from datetime import date, datetime, time, timedelta
from enum import StrEnum
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admissions import ApplicationStatus
from app.auth.deps import CurrentUser, require_role
from app.config import get_settings
from app.db import get_db
from app.models import Application, ApplicationEvent, ApplicationPayment, Intake, Person, Programme
from app.pdf import make_pdf
from app.services import clock, phones

router = APIRouter(prefix="/apply", tags=["apply"])
applicant = require_role("applicant")

OPEN = ("submitted", "in_review", "more_info")


class ApplyStep(StrEnum):
    programme = "programme"
    national_id = "national_id"
    birth_certificate = "birth_certificate"
    results = "results"
    review = "review"
    submit = "submit"


# --- helpers ------------------------------------------------------------------------------------


def entry_text(rules: dict) -> str:
    """'5 O-Levels at C or better, including English Language and Mathematics'"""
    subjects = rules.get("required_subjects", [])
    if len(subjects) > 1:
        including = ", ".join(subjects[:-1]) + " and " + subjects[-1]
    else:
        including = "".join(subjects)
    passes, level, grade = rules.get("min_passes", 5), rules.get("level", "O"), rules.get("min_grade", "C")
    head = f"{passes} {level}-Levels at {grade} or better"
    return f"{head}, including {including}" if including else head


def _years(terms: int) -> str:
    y = (terms + 1) // 2
    return f"{y} {'year' if y == 1 else 'years'}"


def add_working_days(d: date, n: int) -> date:
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


async def _person(db: AsyncSession, cu: CurrentUser) -> Person:
    p = (await db.execute(select(Person).where(Person.user_id == cu.user.id))).scalar_one_or_none()
    if p is None:
        # A new Authentik account: the name comes from the enrollment prompt (display name).
        first, _, last = (cu.user.display_name or "Applicant").rpartition(" ")
        p = Person(user_id=cu.user.id, first_names=first or last, surname=last if first else "")
        db.add(p)
        await db.flush()
    return p


async def _open_intake(db: AsyncSession) -> Intake:
    now = clock.now()
    intake = (
        (
            await db.execute(
                select(Intake).where(Intake.opens_at <= now, Intake.closes_at > now).order_by(Intake.opens_at)
            )
        )
        .scalars()
        .first()
    )
    if intake is None:
        raise HTTPException(409, "Applications are closed at the moment.")
    return intake


async def _current(db: AsyncSession, person: Person) -> Application | None:
    """The applicant's latest application that hasn't been withdrawn."""
    return (
        (
            await db.execute(
                select(Application)
                .where(Application.person_id == person.id, Application.status != "withdrawn")
                .order_by(Application.created_at.desc())
            )
        )
        .unique()
        .scalars()
        .first()
    )


async def _reference(db: AsyncSession, intake: Intake) -> str:
    n = await db.scalar(text("SELECT nextval('application_reference_seq')"))
    year = intake.code[2:4] if intake.code[:2] == "20" else f"{clock.today():%y}"
    return f"APP-{year}-{n:05d}"


# --- programmes ---------------------------------------------------------------------------------


class ProgrammeChoice(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    award: str | None
    length: str
    entry: str


@router.get("/programmes")
async def programmes(
    _: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> list[ProgrammeChoice]:
    rows = (
        await db.execute(
            select(Programme)
            .where(Programme.is_accepting_applications)
            .order_by(Programme.level.desc(), Programme.name)
        )
    ).scalars()
    return [
        ProgrammeChoice(
            id=p.id,
            code=p.code,
            name=p.name,
            award=p.award,
            length=_years(p.duration_terms),
            entry=entry_text(p.entry_rules or {}),
        )
        for p in rows
    ]


# --- the application ----------------------------------------------------------------------------


class Steps(BaseModel):
    programme: bool
    national_id: bool
    birth_certificate: bool
    results: bool


class InfoRequest(BaseModel):
    message: str
    at: datetime


class Offer(BaseModel):
    starts_on: date | None
    accept_by: date
    registration_at: datetime | None
    registration_place: str
    accepted_at: datetime | None
    declined_at: datetime | None


class FeePaid(BaseModel):
    amount: str
    method: str  # "EcoCash"
    receipt: str | None
    paid_at: datetime | None


class MyApplication(BaseModel):
    id: uuid.UUID
    reference: str
    status: ApplicationStatus
    programme_id: uuid.UUID
    programme: str
    intake: str
    name: str
    initials: str
    created_at: datetime
    submitted_at: datetime | None
    review_started_at: datetime | None
    decision_expected_by: date | None
    decided_at: datetime | None
    decision_reason: str | None
    requests: list[InfoRequest]
    steps: Steps
    next_step: ApplyStep | None
    phone_masked: str | None
    offer: Offer | None
    fee: FeePaid | None  # design/Submitted "Fee paid US$ 20.00 · EcoCash · receipt EC-8841027"
    payment_waiting: bool  # bank or cash, waiting for Accounts to confirm


async def _out(db: AsyncSession, a: Application) -> MyApplication:
    events = (
        (
            await db.execute(
                select(ApplicationEvent)
                .where(ApplicationEvent.application_id == a.id)
                .order_by(ApplicationEvent.created_at)
            )
        )
        .scalars()
        .all()
    )
    review = next((e.created_at for e in events if e.to_status == "in_review" or e.kind == "assigned"), None)
    requests = [
        InfoRequest(message=e.comment, at=e.created_at)
        for e in events
        if e.to_status == "more_info" and e.comment and e.visible_to_applicant
    ]
    s = get_settings()
    steps = Steps(
        programme=True,
        national_id=a.person.national_id_enc is not None,
        birth_certificate=any(
            d.kind == "birth_certificate" and d.status in ("confirmed", "approved") for d in a.documents
        ),
        results=bool(a.sittings),
    )
    next_step = None
    if a.status == "draft":
        next_step = next(
            (
                k
                for k, done in (
                    ("national_id", steps.national_id),
                    ("birth_certificate", steps.birth_certificate),
                    ("results", steps.results),
                )
                if not done
            ),
            "review",
        )
    offer = None
    if a.status == "accepted" and a.decided_at:
        starts = a.intake.first_term.starts_on if a.intake.first_term else None
        offer = Offer(
            starts_on=starts,
            accept_by=a.decided_at.astimezone(clock.tz()).date() + timedelta(days=s.offer_accept_days),
            registration_at=clock.at(starts, time.fromisoformat(s.registration_time)) if starts else None,
            registration_place=s.registration_location,
            accepted_at=a.offer_accepted_at,
            declined_at=a.offer_declined_at,
        )
    pay = (
        (
            await db.execute(
                select(ApplicationPayment)
                .where(ApplicationPayment.application_id == a.id)
                .order_by(ApplicationPayment.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    labels = {"ecocash": "EcoCash", "onemoney": "OneMoney", "bank": "Bank transfer", "cash": "Cash"}
    fee = (
        FeePaid(
            amount=f"{pay.amount:.2f}", method=labels[pay.method], receipt=pay.receipt, paid_at=pay.paid_at
        )
        if pay and pay.status == "paid"
        else None
    )
    if next_step == "review" and a.declared_at:
        next_step = "submit"
    p = a.person
    user = p.user
    return MyApplication(
        id=a.id,
        reference=a.reference or "",
        status=ApplicationStatus(a.status),
        programme_id=a.programme_id,
        programme=a.programme.name,
        intake=a.intake.name,
        name=f"{p.first_names} {p.surname}".strip(),
        initials=f"{p.first_names[:1]}{p.surname[:1]}".upper(),
        created_at=a.created_at,
        submitted_at=a.submitted_at,
        review_started_at=review,
        decision_expected_by=add_working_days(
            a.submitted_at.astimezone(clock.tz()).date(), s.admissions_decision_working_days
        )
        if a.submitted_at and a.status in OPEN
        else None,
        decided_at=a.decided_at,
        decision_reason=a.decision_reason,
        requests=requests,
        steps=steps,
        next_step=ApplyStep(next_step) if next_step else None,
        phone_masked=phones.mask(user.phone) if user and user.phone else None,
        offer=offer,
        fee=fee,
        payment_waiting=bool(pay and pay.status == "awaiting_confirmation"),
    )


@router.get("/application")
async def my_application(
    cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> MyApplication | None:
    a = await _current(db, await _person(db, cu))
    await db.commit()
    return await _out(db, a) if a else None


class ProgrammeIn(BaseModel):
    programme_id: uuid.UUID


@router.put("/application/programme")
async def choose_programme(
    body: ProgrammeIn, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> MyApplication:
    """Starts the application on first choice; the programme can change until it's submitted."""
    prog = await db.get(Programme, body.programme_id)
    if prog is None or not prog.is_accepting_applications:
        raise HTTPException(422, "That programme isn't taking applications.")
    person = await _person(db, cu)
    a = await _current(db, person)
    if a is None:
        intake = await _open_intake(db)
        now = clock.now()
        a = Application(
            reference=await _reference(db, intake),
            person_id=person.id,
            intake_id=intake.id,
            programme_id=prog.id,
            status="draft",
            consent_processing_at=now,
        )
        db.add(a)
        await db.flush()
        db.add(
            ApplicationEvent(
                application_id=a.id, actor_id=cu.user.id, kind="status", to_status="draft", via="computer"
            )
        )
    elif a.status != "draft":
        raise HTTPException(409, "Your application has been submitted, so the programme can't change.")
    else:
        a.programme_id = prog.id
        a.updated_at = clock.now()
    await db.commit()
    a = await _current(db, person)
    await db.refresh(a, ["programme"])
    return await _out(db, a)


@router.post("/application/withdraw")
async def withdraw(cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)) -> MyApplication:
    a = await _current(db, await _person(db, cu))
    if a is None or a.status not in (*OPEN, "draft"):
        raise HTTPException(409, "There's no application to withdraw.")
    db.add(
        ApplicationEvent(
            application_id=a.id,
            actor_id=cu.user.id,
            kind="status",
            from_status=a.status,
            to_status="withdrawn",
        )
    )
    a.status, a.updated_at = "withdrawn", clock.now()
    await db.commit()
    return await _out(db, a)


# --- offer --------------------------------------------------------------------------------------


class OfferAnswer(StrEnum):
    accept = "accept"
    decline = "decline"


class OfferIn(BaseModel):
    answer: OfferAnswer


@router.post("/offer")
async def answer_offer(
    body: OfferIn, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> MyApplication:
    a = await _current(db, await _person(db, cu))
    if a is None or a.status != "accepted":
        raise HTTPException(409, "There's no offer to answer.")
    if a.offer_accepted_at or a.offer_declined_at:
        raise HTTPException(409, "You've already answered this offer.")
    out = await _out(db, a)
    if out.offer and clock.today() > out.offer.accept_by:
        raise HTTPException(409, "The date to accept this offer has passed. Contact Admissions.")
    now = clock.now()
    if body.answer == OfferAnswer.accept:
        a.offer_accepted_at = now
        comment = "Offer accepted"
    else:
        a.offer_declined_at = now
        comment = "Offer declined"
    db.add(
        ApplicationEvent(
            application_id=a.id, actor_id=cu.user.id, kind="note", comment=comment, visible_to_applicant=True
        )
    )
    await db.commit()
    return await _out(db, a)


@router.get("/offer/letter.pdf", response_class=Response)
async def offer_letter(cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)) -> Response:
    a = await _current(db, await _person(db, cu))
    if a is None or a.status != "accepted":
        raise HTTPException(404, "There's no offer letter.")
    o = (await _out(db, a)).offer
    name = f"{a.person.first_names} {a.person.surname}"
    lines = [
        f"Reference {a.reference}",
        f"Dear {name},",
        f"We are pleased to offer you a place on the {a.programme.name}.",
    ]
    if o and o.starts_on:
        lines.append(f"The programme starts on {o.starts_on:%A} {o.starts_on.day} {o.starts_on:%B %Y}.")
    if o:
        lines.append(f"Please accept this offer in the portal by {o.accept_by.day} {o.accept_by:%B %Y}.")
    lines.append("Bring your original National ID and ZIMSEC certificate to registration.")
    pdf = make_pdf("TelOne Centre for Learning: offer of a place", lines)
    filename = f"Offer letter {a.reference}.pdf"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
