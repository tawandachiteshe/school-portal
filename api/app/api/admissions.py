"""Admissions queue and application review (design/StaffQueue, StaffReview)."""

import csv
import io
import re
import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crypto, storage
from app.auth.deps import CurrentUser, require_role
from app.config import get_settings
from app.db import DbDep
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationFlag,
    DistrictCode,
    Document,
    DocumentField,
    Notification,
    NotificationDelivery,
    Person,
    User,
)
from app.services import audit, clock, eligibility, phones
from app.services.names import name_words

router = APIRouter(prefix="/staff/admissions", tags=["admissions"])
officer = require_role("admissions", "admin")
OfficerDep = Annotated[CurrentUser, Depends(officer)]

UNCLEAR = 0.8  # below this, a read value was shown to the applicant to confirm
OPEN = ("submitted", "in_review")
DECIDED = ("accepted", "rejected", "withdrawn")


class QueueTab(StrEnum):
    to_review = "to_review"
    needs_checking = "needs_checking"
    waiting = "waiting"
    decided = "decided"


class AttentionLevel(StrEnum):
    amber = "amber"
    muted = "muted"


class ApplicationStatus(StrEnum):
    draft = "draft"
    submitted = "submitted"
    in_review = "in_review"
    more_info = "more_info"
    accepted = "accepted"
    rejected = "rejected"
    withdrawn = "withdrawn"


# --- shared -------------------------------------------------------------------------------------


def _full_name(p: Person) -> str:
    return f"{p.first_names} {p.surname}"


def _initials(p: Person | None) -> str:
    return f"{p.first_names[:1]}{p.surname[:1]}".upper() if p else ""


def _short_name(p: Person | None) -> str:
    """'C. Marufu'"""
    return f"{p.first_names[:1]}. {p.surname}" if p else "someone"


def _programme_short(name: str) -> str:
    return name.replace("Diploma in ", "Dip. ").replace("Certificate in ", "Cert. ")


def _national_id(p: Person) -> str | None:
    if p.national_id_enc:
        return crypto.decrypt(p.national_id_enc)
    return p.national_id_masked


def _open_flags(a: Application) -> list[ApplicationFlag]:
    return [f for f in a.flags if f.resolved_at is None]


def tab_of(a: Application) -> QueueTab | None:
    if a.status in DECIDED:
        return QueueTab.decided
    if a.status == "more_info":
        return QueueTab.waiting
    if a.status in OPEN:
        if any(f.severity in ("high", "block") for f in _open_flags(a)):
            return QueueTab.needs_checking
        return QueueTab.to_review
    return None


def _slip_fields(a: Application) -> dict[str, tuple[str | None, float | None, bool, str | None]]:
    """subject code → (confirmed grade, confidence, edited by applicant, first read value)"""
    out = {}
    for d in a.documents:
        for f in d.fields:
            m = re.fullmatch(r"subjects\.(\w+)\.grade", f.field)
            if m:
                conf = float(f.confidence) if f.confidence is not None else None
                out[m[1]] = (f.confirmed_value, conf, bool(f.edited_by_applicant), f.llm_value or f.ocr_value)
    return out


def _grades(a: Application, level: str = "O") -> dict[str, str]:
    return eligibility.best_grades(
        [[(r.subject_name, r.grade) for r in s.results] for s in a.sittings if s.level == level]
    )


def _eligibility(a: Application) -> eligibility.Eligibility:
    return eligibility.evaluate(a.programme.entry_rules or {}, _grades(a))


def _unclear_subjects(a: Application) -> set[str]:
    fields = _slip_fields(a)
    return {
        r.subject_name
        for s in a.sittings
        for r in s.results
        if (f := fields.get(r.subject_code or "")) and f[1] is not None and f[1] < UNCLEAR
    }


def _attention(a: Application) -> tuple[str, AttentionLevel] | None:
    flags = sorted(_open_flags(a), key=lambda f: ["block", "high", "medium", "low"].index(f.severity))
    if flags:
        f = flags[0]
        text = (f.detail or {}).get("text", f.code)
        more = f" (+{len(flags) - 1} more)" if len(flags) > 1 else ""
        return text + more, AttentionLevel.amber if f.severity != "low" else AttentionLevel.muted
    unclear = len(_unclear_subjects(a))
    if unclear:
        return (
            f"{unclear} {'grade' if unclear == 1 else 'grades'} confirmed by applicant",
            AttentionLevel.muted,
        )
    later = [s for s in a.sittings if s.level == "O"][1:]
    if later:
        s = later[-1]
        return f"{s.session.title()} {s.year} resit added", AttentionLevel.muted
    return None


async def _people(db: AsyncSession, user_ids: set[uuid.UUID | None]) -> dict[uuid.UUID, Person]:
    ids = {u for u in user_ids if u}
    if not ids:
        return {}
    rows = (await db.execute(select(Person).where(Person.user_id.in_(ids)))).scalars().all()
    return {p.user_id: p for p in rows if p.user_id}


async def _applications(db: AsyncSession) -> list[Application]:
    return list(
        (await db.execute(select(Application).where(Application.status != "draft"))).unique().scalars().all()
    )


def _sorted(apps: list[Application], tab: QueueTab) -> list[Application]:
    rows = [a for a in apps if tab_of(a) == tab]
    if tab == QueueTab.decided:
        return sorted(rows, key=lambda a: a.decided_at or a.updated_at, reverse=True)
    return sorted(rows, key=lambda a: a.submitted_at or a.created_at)  # oldest first


async def _get(db: AsyncSession, reference: str) -> Application:
    a = (
        (await db.execute(select(Application).where(Application.reference == reference)))
        .unique()
        .scalar_one_or_none()
    )
    if a is None or a.status == "draft":
        raise HTTPException(404, "There's no submitted application with that reference.")
    return a


def _event(
    db: AsyncSession, a: Application, cu: CurrentUser, kind: str, comment: str | None = None, **kw
) -> None:
    a.updated_at = clock.now()
    db.add(ApplicationEvent(application_id=a.id, actor_id=cu.user.id, kind=kind, comment=comment, **kw))


# --- queue --------------------------------------------------------------------------------------


class QueueSummary(BaseModel):
    intake: str
    to_review: int
    needs_checking: int
    waiting: int
    decided: int
    open: int  # sidebar "Applications"
    oldest_waiting_days: int | None


class QueueRow(BaseModel):
    id: uuid.UUID
    reference: str
    name: str
    national_id: str | None
    programme_id: uuid.UUID
    programme: str
    status: ApplicationStatus
    submitted_at: datetime | None
    decided_at: datetime | None
    eligible: bool
    eligibility: str
    attention: str | None
    attention_level: AttentionLevel | None
    owner_initials: str | None
    owner_name: str | None
    owner_is_me: bool


@router.get("/summary")
async def queue_summary(_: OfficerDep, db: DbDep) -> QueueSummary:
    apps = await _applications(db)
    tabs = [tab_of(a) for a in apps]
    count = lambda t: tabs.count(t)  # noqa: E731
    waiting = [
        a.submitted_at
        for a in apps
        if tab_of(a) in (QueueTab.to_review, QueueTab.needs_checking) and a.submitted_at
    ]
    oldest = (clock.today() - min(waiting).astimezone(clock.tz()).date()).days if waiting else None
    intake = apps[0].intake.name if apps else ""
    return QueueSummary(
        intake=intake,
        to_review=count(QueueTab.to_review),
        needs_checking=count(QueueTab.needs_checking),
        waiting=count(QueueTab.waiting),
        decided=count(QueueTab.decided),
        open=count(QueueTab.to_review) + count(QueueTab.needs_checking) + count(QueueTab.waiting),
        oldest_waiting_days=oldest,
    )


async def _rows(db: AsyncSession, cu: CurrentUser, tab: QueueTab) -> list[QueueRow]:
    apps = _sorted(await _applications(db), tab)
    owners = await _people(db, {a.assigned_to for a in apps})
    out = []
    for a in apps:
        el = _eligibility(a)
        att = _attention(a)
        owner = owners.get(a.assigned_to) if a.assigned_to else None
        out.append(
            QueueRow(
                id=a.id,
                reference=a.reference or "",
                name=_full_name(a.person),
                national_id=_national_id(a.person),
                programme_id=a.programme_id,
                programme=_programme_short(a.programme.name),
                status=ApplicationStatus(a.status),
                submitted_at=a.submitted_at,
                decided_at=a.decided_at,
                eligible=el.eligible,
                eligibility=el.summary,
                attention=att[0] if att else None,
                attention_level=att[1] if att else None,
                owner_initials=_initials(owner) if owner else None,
                owner_name=_short_name(owner) if owner else None,
                owner_is_me=a.assigned_to == cu.user.id,
            )
        )
    return out


@router.get("/applications")
async def queue(cu: OfficerDep, db: DbDep, tab: QueueTab = QueueTab.to_review) -> list[QueueRow]:
    return await _rows(db, cu, tab)


@router.get("/applications.csv", response_class=Response)
async def queue_csv(cu: OfficerDep, db: DbDep, tab: QueueTab = QueueTab.to_review) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "Reference",
            "Applicant",
            "National ID",
            "Programme",
            "Submitted",
            "Eligibility",
            "Needs attention",
            "Owner",
        ]
    )
    for r in await _rows(db, cu, tab):
        submitted = r.submitted_at.astimezone(clock.tz()).strftime("%Y-%m-%d %H:%M") if r.submitted_at else ""
        w.writerow(
            [
                r.reference,
                r.name,
                r.national_id or "",
                r.programme,
                submitted,
                r.eligibility,
                r.attention or "",
                r.owner_name or "",
            ]
        )
    name = f"applications-{tab.value.replace('_', '-')}-{clock.today().isoformat()}.csv"
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# --- review -------------------------------------------------------------------------------------


class ReviewNav(BaseModel):
    tab: QueueTab
    position: int
    total: int
    previous: str | None
    next: str | None


class RequirementRow(BaseModel):
    label: str
    needed: str
    applicant: str
    met: bool


class ReviewEligibility(BaseModel):
    eligible: bool
    summary: str
    rows: list[RequirementRow]


class Identity(BaseModel):
    document_id: uuid.UUID | None
    capture_device: str | None
    captured_at: datetime | None
    id_number: str | None
    check_letter_valid: bool | None
    name_on_id: str | None
    name_on_slip: str | None
    names_match: bool | None
    date_of_birth: date | None
    age_at_intake: int | None
    registered_in: str | None
    origin: str | None
    edited: list[str]
    checked_by: str | None
    checked_at: datetime | None
    birth_certificate_id: uuid.UUID | None
    birth_name: str | None  # as printed on the certificate, confirmed by the applicant
    birth_date_of_birth: date | None


class ReadHow(StrEnum):
    clear = "clear"
    unclear_confirmed = "unclear_confirmed"
    changed = "changed"


class SubjectRow(BaseModel):
    code: str | None
    subject: str
    grade: str
    read: ReadHow
    read_as: str | None  # what the scan said, when the applicant changed it


class Sitting(BaseModel):
    id: uuid.UUID
    level: str
    session: str
    year: int
    centre_number: str
    candidate_number: str
    document_id: uuid.UUID | None
    verification: str
    verified_at: datetime | None
    rows: list[SubjectRow]


class Activity(BaseModel):
    text: str
    at: datetime
    via: str | None
    by: str | None
    note: bool


class Flag(BaseModel):
    id: int
    text: str
    severity: str


class Contact(BaseModel):
    phone_masked: str | None
    verified: bool


class Review(BaseModel):
    id: uuid.UUID
    reference: str
    name: str
    status: ApplicationStatus
    programme: str
    submitted_at: datetime | None
    assigned_to: str | None
    assigned_to_me: bool
    decided_at: datetime | None
    decided_by: str | None
    decision_reason: str | None
    nav: ReviewNav | None
    eligibility: ReviewEligibility
    unclear_decides: bool
    unclear_count: int
    identity: Identity
    sittings: list[Sitting]
    flags: list[Flag]
    contact: Contact
    activity: list[Activity]


FIELD_LABELS = {
    "national_id": "ID number",
    "surname": "surname",
    "first_names": "first names",
    "date_of_birth": "date of birth",
}
STATUS_TEXT = {
    "draft": "Application started",
    "submitted": "Submitted",
    "in_review": "Review started",
    "more_info": "Asked for more information",
    "accepted": "Offered a place",
    "rejected": "Declined",
    "withdrawn": "Withdrawn by applicant",
}


async def _identity(db: AsyncSession, a: Application, people: dict[uuid.UUID, Person]) -> Identity:
    doc = next((d for d in a.documents if d.kind == "national_id"), None)
    fields = {f.field: f for f in doc.fields} if doc else {}
    val = lambda k: fields[k].confirmed_value if k in fields else None  # noqa: E731
    p = a.person
    on_id = " ".join(x for x in (val("first_names"), val("surname")) if x) or None
    slip = next((s.candidate_name for s in a.sittings), None)
    dob = p.date_of_birth
    starts = a.intake.first_term.starts_on if a.intake.first_term else a.intake.opens_at.date()
    age = None
    if dob:
        age = starts.year - dob.year - ((starts.month, starts.day) < (dob.month, dob.day))
    districts = {
        d.code: d.district
        for d in (
            await db.execute(
                select(DistrictCode).where(
                    DistrictCode.code.in_([c for c in (p.id_reg_district, p.id_origin_district) if c])
                )
            )
        ).scalars()
    }
    district = lambda c: districts.get(c, f"district {c}") if c else None  # noqa: E731
    checked = doc and doc.status == "approved"
    births = [
        d for d in a.documents if d.kind == "birth_certificate" and d.status in ("confirmed", "approved")
    ]
    birth = max(births, key=lambda d: d.created_at) if births else None
    bf: dict[str, str | None] = {}
    if birth:
        rows = await db.execute(select(DocumentField).where(DocumentField.document_id == birth.id))
        bf = {f.field: f.confirmed_value for f in rows.scalars()}
    return Identity(
        document_id=doc.id if doc else None,
        capture_device=doc.capture_device if doc else None,
        captured_at=doc.created_at if doc else None,
        id_number=_national_id(p),
        check_letter_valid=p.national_id_valid,
        name_on_id=on_id.upper() if on_id else None,
        name_on_slip=slip.upper() if slip else None,
        names_match=name_words(on_id) == name_words(slip) if on_id and slip else None,
        date_of_birth=dob,
        age_at_intake=age,
        registered_in=district(p.id_reg_district),
        origin=district(p.id_origin_district),
        edited=[FIELD_LABELS.get(f.field, f.field) for f in fields.values() if f.edited_by_applicant],
        checked_by=_short_name(people.get(doc.reviewed_by)) if checked and doc.reviewed_by else None,
        checked_at=doc.reviewed_at if checked else None,
        birth_certificate_id=birth.id if birth else None,
        birth_name=bf.get("full_name"),
        birth_date_of_birth=date.fromisoformat(bf["date_of_birth"]) if bf.get("date_of_birth") else None,
    )


async def _review(db: AsyncSession, cu: CurrentUser, a: Application) -> Review:
    events = (
        (
            await db.execute(
                select(ApplicationEvent)
                .where(ApplicationEvent.application_id == a.id)
                .order_by(ApplicationEvent.created_at.desc(), ApplicationEvent.id.desc())
            )
        )
        .scalars()
        .all()
    )
    docs = [d.reviewed_by for d in a.documents]
    people = await _people(db, {a.assigned_to, a.decided_by, *docs, *(e.actor_id for e in events)})

    nav = None
    tab = tab_of(a)
    if tab:
        refs = [x.reference for x in _sorted(await _applications(db), tab)]
        i = refs.index(a.reference)
        nav = ReviewNav(
            tab=tab,
            position=i + 1,
            total=len(refs),
            previous=refs[i - 1] if i > 0 else None,
            next=refs[i + 1] if i + 1 < len(refs) else None,
        )

    el = _eligibility(a)
    unclear = _unclear_subjects(a)
    fields = _slip_fields(a)
    sittings = []
    for s in sorted(a.sittings, key=lambda s: (s.level, s.year, s.session == "NOVEMBER")):
        rows = []
        for r in s.results:
            f = fields.get(r.subject_code or "")
            how, read_as = ReadHow.clear, None
            if f and f[1] is not None and f[1] < UNCLEAR:
                how = ReadHow.unclear_confirmed
            elif f and f[2]:
                how, read_as = ReadHow.changed, f[3]
            rows.append(
                SubjectRow(
                    code=r.subject_code, subject=r.subject_name, grade=r.grade, read=how, read_as=read_as
                )
            )
        sittings.append(
            Sitting(
                id=s.id,
                level=s.level,
                session=s.session,
                year=s.year,
                centre_number=s.centre_number,
                candidate_number=s.candidate_number,
                document_id=s.document_id,
                verification=s.verification,
                verified_at=s.verified_at,
                rows=rows,
            )
        )

    activity = []
    for e in events:
        who = people.get(e.actor_id) if e.actor_id else None
        if e.kind == "status":
            text = STATUS_TEXT.get(e.to_status or "", "Status changed")
            if e.comment and e.to_status in ("more_info", "rejected"):
                text += f": “{e.comment}”"
        else:
            text = e.comment or ""
        activity.append(
            Activity(
                text=text,
                at=e.created_at,
                via=e.via,
                by=_short_name(who)
                if who and e.kind in ("note", "message", "status") and e.to_status != "submitted"
                else None,
                note=e.kind == "note",
            )
        )

    user = a.person.user
    return Review(
        id=a.id,
        reference=a.reference or "",
        name=_full_name(a.person),
        status=ApplicationStatus(a.status),
        programme=a.programme.name,
        submitted_at=a.submitted_at,
        assigned_to=_short_name(people.get(a.assigned_to)) if a.assigned_to else None,
        assigned_to_me=a.assigned_to == cu.user.id,
        decided_at=a.decided_at,
        decided_by=_short_name(people.get(a.decided_by)) if a.decided_by else None,
        decision_reason=a.decision_reason,
        nav=nav,
        eligibility=ReviewEligibility(
            eligible=el.eligible,
            summary=el.summary,
            rows=[
                RequirementRow(label=r.label, needed=r.needed, applicant=r.applicant, met=r.met)
                for r in el.rows
            ],
        ),
        unclear_decides=eligibility.unclear_decides(a.programme.entry_rules or {}, _grades(a), unclear),
        unclear_count=len(unclear),
        identity=await _identity(db, a, people),
        sittings=sittings,
        flags=[
            Flag(id=f.id, text=(f.detail or {}).get("text", f.code), severity=f.severity)
            for f in sorted(_open_flags(a), key=lambda f: f.id)
        ],
        contact=Contact(
            phone_masked=phones.mask(user.phone) if user and user.phone else None,
            verified=bool(user and user.phone),
        ),
        activity=activity,
    )


@router.get("/applications/{reference}")
async def review(reference: str, request: Request, cu: OfficerDep, db: DbDep) -> Review:
    a = await _get(db, reference)
    # The review shows the National ID number, date of birth and results (docs/07: audited).
    await audit.record(db, cu, request, "application.view", "application", a.reference)
    await db.commit()
    return await _review(db, cu, a)


@router.post("/applications/{reference}/assign")
async def assign_to_me(reference: str, cu: OfficerDep, db: DbDep) -> Review:
    """Opening an unassigned application takes it: it moves to "In review" under your name."""
    a = await _get(db, reference)
    if a.status not in OPEN:
        raise HTTPException(409, "This application isn't waiting for review.")
    if a.assigned_to != cu.user.id:
        me = (await _people(db, {cu.user.id})).get(cu.user.id)
        a.assigned_to = cu.user.id
        _event(db, a, cu, "assigned", f"Assigned to {_short_name(me)}")
    if a.status == "submitted":
        _event(db, a, cu, "status", from_status=a.status, to_status="in_review")
        a.status = "in_review"
    await db.commit()
    return await _review(db, cu, a)


def _require_open(a: Application) -> None:
    if a.status not in (*OPEN, "more_info"):
        raise HTTPException(409, "A decision has already been made on this application.")


@router.post("/applications/{reference}/identity-checked")
async def mark_identity_checked(reference: str, request: Request, cu: OfficerDep, db: DbDep) -> Review:
    a = await _get(db, reference)
    await audit.record(db, cu, request, "application.identity_checked", "application", a.reference)
    doc = next((d for d in a.documents if d.kind == "national_id"), None)
    if doc is None:
        raise HTTPException(409, "There's no National ID photo on this application.")
    if doc.status != "approved":
        me = (await _people(db, {cu.user.id})).get(cu.user.id)
        doc.status, doc.reviewed_by, doc.reviewed_at = "approved", cu.user.id, clock.now()
        _event(db, a, cu, "identity_checked", f"Identity checked by {_short_name(me)}")
        await db.commit()
    return await _review(db, cu, a)


@router.post("/applications/{reference}/sittings/{sitting_id}/verified")
async def mark_zimsec_verified(
    reference: str,
    sitting_id: uuid.UUID,
    request: Request,
    cu: OfficerDep,
    db: DbDep,
) -> Review:
    a = await _get(db, reference)
    await audit.record(db, cu, request, "application.zimsec_verified", "application", a.reference)
    s = next((s for s in a.sittings if s.id == sitting_id), None)
    if s is None:
        raise HTTPException(404, "That exam sitting isn't on this application.")
    if s.verification != "verified":
        me = (await _people(db, {cu.user.id})).get(cu.user.id)
        s.verification, s.verified_at = "verified", clock.now()
        _event(
            db,
            a,
            cu,
            "zimsec_verified",
            f"{s.session.title()} {s.year} results verified with ZIMSEC by {_short_name(me)}",
        )
        await db.commit()
    return await _review(db, cu, a)


class ResolveIn(BaseModel):
    resolution: str = Field(min_length=1, max_length=500)


@router.post("/applications/{reference}/flags/{flag_id}/resolve")
async def resolve_flag(
    reference: str,
    flag_id: int,
    body: ResolveIn,
    cu: OfficerDep,
    db: DbDep,
) -> Review:
    a = await _get(db, reference)
    f = next((f for f in a.flags if f.id == flag_id), None)
    if f is None:
        raise HTTPException(404, "That check isn't on this application.")
    if f.resolved_at is None:
        f.resolved_by, f.resolved_at, f.resolution = cu.user.id, clock.now(), body.resolution.strip()
        _event(
            db, a, cu, "flag_resolved", f"Checked “{(f.detail or {}).get('text', f.code)}”: {f.resolution}"
        )
        await db.commit()
    return await _review(db, cu, a)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/applications/{reference}/notes")
async def add_note(reference: str, body: NoteIn, cu: OfficerDep, db: DbDep) -> Review:
    a = await _get(db, reference)
    _event(db, a, cu, "note", body.text.strip())
    await db.commit()
    return await _review(db, cu, a)


def _notify(db: AsyncSession, a: Application, title: str, body: str | None, sms: bool, key: str) -> bool:
    """In-app notification to the applicant, plus a queued SMS when they have a phone."""
    user: User | None = a.person.user
    if user is None:
        return False
    n = Notification(
        user_id=user.id, category="application", title=title, body=body, link="/apply/status", dedupe_key=key
    )
    db.add(n)
    if sms and user.phone:
        # Sent by the SMS worker once a provider is configured (SMS_PROVIDER).
        db.add(NotificationDelivery(notification=n, channel="sms", status="queued"))
        return True
    return False


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=160)


class Sent(BaseModel):
    sms_queued: bool


@router.post("/applications/{reference}/message")
async def send_message(reference: str, body: MessageIn, cu: OfficerDep, db: DbDep) -> Sent:
    a = await _get(db, reference)
    if not (a.person.user and a.person.user.phone):
        raise HTTPException(409, "This applicant has no phone number.")
    queued = _notify(
        db, a, "Message from TCFL Admissions", body.text.strip(), True, f"admissions-sms:{uuid.uuid4()}"
    )
    _event(db, a, cu, "message", f"SMS sent: “{body.text.strip()}”", visible_to_applicant=True)
    await db.commit()
    return Sent(sms_queued=queued)


class Decision(StrEnum):
    offer = "offer"
    decline = "decline"
    ask = "ask"


class DecisionIn(BaseModel):
    decision: Decision
    message: str | None = Field(default=None, max_length=1000)


@router.post("/applications/{reference}/decision")
async def decide(
    reference: str,
    body: DecisionIn,
    request: Request,
    cu: OfficerDep,
    db: DbDep,
) -> Review:
    a = await _get(db, reference)
    _require_open(a)
    message = (body.message or "").strip() or None
    if body.decision in (Decision.decline, Decision.ask) and not message:
        raise HTTPException(
            422,
            "Say why, so the applicant knows."
            if body.decision == Decision.decline
            else "Say what you need from the applicant.",
        )
    now = clock.now()
    to = {Decision.offer: "accepted", Decision.decline: "rejected", Decision.ask: "more_info"}[body.decision]
    _event(db, a, cu, "status", message, from_status=a.status, to_status=to, visible_to_applicant=True)
    a.status = to
    if body.decision != Decision.ask:
        a.decided_by, a.decided_at, a.decision_reason = cu.user.id, now, message
    title = {
        Decision.offer: f"You've been offered a place on the {a.programme.name}",
        Decision.decline: f"Your application for the {a.programme.name} was not successful",
        Decision.ask: "TCFL Admissions needs more information for your application",
    }[body.decision]
    _notify(db, a, title, message, True, f"application:{a.id}:{to}:{now:%Y%m%d%H%M%S}")
    await audit.record(db, cu, request, "application.decide", "application", a.reference, {"status": to})
    await db.commit()
    return await _review(db, cu, a)


# --- documents ----------------------------------------------------------------------------------


@router.get("/documents/{document_id}/file", response_class=StreamingResponse)
async def document_file(
    document_id: uuid.UUID,
    request: Request,
    cu: OfficerDep,
    db: DbDep,
) -> StreamingResponse:
    d = await db.get(Document, document_id)
    bucket = get_settings().s3_bucket_documents
    if d is None or await storage.size(bucket, d.object_key) is None:
        raise HTTPException(404, "This document is missing.")
    await audit.record(db, cu, request, "document.view", "document", str(d.id), {"kind": d.kind})
    await db.commit()
    return StreamingResponse(
        storage.stream(bucket, d.object_key),
        media_type=d.mime_type,
        headers={"Cache-Control": "private, max-age=3600", "Content-Disposition": "inline"},
    )
