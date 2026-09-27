"""Step 2 · National ID, on the computer or on a linked phone (design/IdDesktop, Handoff*, Phone*,
IdError). docs/10 §10.10 describes the handoff: a short-lived link gives a phone an onboarding-only
session for one application; the computer sees what the phone adds."""

import hashlib
import re
import secrets
import uuid
from datetime import date, datetime, timedelta
from enum import StrEnum

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crypto, storage
from app.api.apply import _current, _person, applicant
from app.auth.deps import CurrentUser
from app.config import get_settings
from app.db import get_db, get_sessionmaker
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationFlag,
    DeviceHandoff,
    DistrictCode,
    Document,
    DocumentField,
    Notification,
    NotificationDelivery,
    Person,
)
from app.ocr.id_reader import read_national_id
from app.ocr.national_id import decode
from app.services import clock

router = APIRouter(tags=["apply id"])
HANDOFF_COOKIE = "portal_handoff"
ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"  # no 0/O, 1/I/L or U: easy to type on a phone
ACCEPTED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}
FIELDS = ("national_id", "surname", "first_names", "date_of_birth")


# --- shared -------------------------------------------------------------------------------------


def device_of(user_agent: str | None) -> tuple[str, str]:
    """('phone', 'Android · Chrome') from a User-Agent, roughly. Informational only."""
    ua = user_agent or ""
    os_ = next(
        (
            n
            for k, n in (
                ("Android", "Android"),
                ("iPhone", "iPhone"),
                ("iPad", "iPad"),
                ("Windows", "Windows"),
                ("Mac OS", "Mac"),
                ("Linux", "Linux"),
            )
            if k in ua
        ),
        "",
    )
    browser = next(
        (
            n
            for k, n in (
                ("Edg/", "Edge"),
                ("SamsungBrowser", "Samsung Internet"),
                ("OPR/", "Opera"),
                ("Firefox/", "Firefox"),
                ("CriOS", "Chrome"),
                ("Chrome/", "Chrome"),
                ("Safari/", "Safari"),
            )
            if k in ua
        ),
        "",
    )
    kind = "phone" if re.search(r"Mobi|Android|iPhone", ua) else "computer"
    return kind, " · ".join(x for x in (os_, browser) if x)


class IdStatus(StrEnum):
    none = "none"
    reading = "reading"
    read = "read"
    failed = "failed"
    confirmed = "confirmed"


class IdFields(BaseModel):
    id_number: str | None
    surname: str | None
    first_names: str | None
    date_of_birth: date | None


class NationalIdState(BaseModel):
    status: IdStatus
    document_id: uuid.UUID | None
    received_at: datetime | None
    read_at: datetime | None
    capture_device: str | None
    fields: IdFields
    low_confidence: list[str]  # which fields to look at twice
    check_letter_valid: bool | None
    expected_letter: str | None
    registered_in: str | None
    origin: str | None
    error: str | None


def _latest_id_doc(a: Application) -> Document | None:
    docs = [d for d in a.documents if d.kind == "national_id"]
    return max(docs, key=lambda d: d.created_at) if docs else None


async def id_state(db: AsyncSession, a: Application) -> NationalIdState:
    doc = _latest_id_doc(a)
    p = a.person
    confirmed = p.national_id_enc is not None and (doc is None or doc.status in ("confirmed", "approved"))
    fields = {}
    if doc:
        rows = await db.execute(select(DocumentField).where(DocumentField.document_id == doc.id))
        fields = {f.field: f for f in rows.scalars()}

    def val(k: str) -> str | None:
        f = fields.get(k)
        return (f.confirmed_value or f.llm_value or f.ocr_value) if f else None

    if confirmed:
        number = crypto.decrypt(p.national_id_enc)
        values = IdFields(
            id_number=number,
            surname=p.surname.upper(),
            first_names=p.first_names.upper(),
            date_of_birth=p.date_of_birth,
        )
        status = IdStatus.confirmed
    else:
        dob = val("date_of_birth")
        values = IdFields(
            id_number=val("national_id"),
            surname=val("surname"),
            first_names=val("first_names"),
            date_of_birth=date.fromisoformat(dob) if dob else None,
        )
        status = {
            None: IdStatus.none,
            "uploaded": IdStatus.reading,
            "processing": IdStatus.reading,
            "extracted": IdStatus.read,
            "failed": IdStatus.failed,
        }.get(doc.status if doc else None, IdStatus.read)
    d = decode(values.id_number or "")
    districts = {}
    if d:
        rows = await db.execute(
            select(DistrictCode).where(DistrictCode.code.in_([d.reg_code, d.origin_code]))
        )
        districts = {r.code: r.district for r in rows.scalars()}
    low = [
        {"national_id": "id_number"}.get(k, k)
        for k, f in fields.items()
        if f.confidence is not None and float(f.confidence) < get_settings().ocr_min_confidence
    ]
    return NationalIdState(
        status=status,
        document_id=doc.id if doc else None,
        received_at=doc.created_at if doc else None,
        read_at=doc.updated_at if doc and doc.status not in ("uploaded", "processing") else None,
        capture_device=doc.capture_device if doc else None,
        fields=values,
        low_confidence=[] if confirmed else low,
        check_letter_valid=d.check_letter_valid if d else None,
        expected_letter=d.expected_letter if d else None,
        registered_in=districts.get(d.reg_code) if d else None,
        origin=districts.get(d.origin_code) if d else None,
        error=doc.error if doc and doc.status == "failed" else None,
    )


async def _read_document(document_id: uuid.UUID) -> None:
    """Background: OCR the photo, store the fields, log "National ID read"."""
    async with get_sessionmaker()() as db:
        doc = await db.get(Document, document_id)
        if doc is None:
            return
        a = await db.get(Application, doc.application_id)
        doc.status = "processing"
        await db.commit()
        try:
            data = storage.get(get_settings().s3_bucket_documents, doc.object_key)
            r = read_national_id(data, doc.mime_type, allow_llm=a.consent_ai_at is not None)
        except Exception as e:  # storage or OCR failure: the applicant types the details instead
            doc.status, doc.error = "failed", f"We couldn't read this photo ({e.__class__.__name__})."
            await db.commit()
            return
        values = {
            "national_id": r.id_number,
            "surname": r.surname,
            "first_names": r.first_names,
            "date_of_birth": r.date_of_birth.isoformat() if r.date_of_birth else None,
        }
        conf = {"national_id": r.confidence.get("id_number")} | {k: r.confidence.get(k) for k in FIELDS[1:]}
        for k, v in values.items():
            if v is None:
                continue
            column = "llm_value" if r.engine == "llm" else "ocr_value"
            db.add(DocumentField(document_id=doc.id, field=k, confidence=conf.get(k), **{column: v}))
        doc.ocr_engine = r.engine if r.engine != "none" else None
        doc.ocr_text = r.text or None
        confs = [c for c in conf.values() if c is not None]
        doc.ocr_confidence = round(sum(confs) / len(confs), 3) if confs else None
        doc.updated_at = clock.now()
        if not any(values.values()):
            doc.status, doc.error = "failed", "We couldn't read the details from this photo."
        else:
            doc.status = "extracted"
            db.add(
                ApplicationEvent(
                    application_id=a.id,
                    kind="document",
                    comment="National ID read",
                    via=(doc.capture_device or "").split(" ")[0] or None,
                )
            )
        await db.commit()


async def _upload(
    db: AsyncSession, a: Application, file: UploadFile, user_agent: str | None, handoff: DeviceHandoff | None
) -> Document:
    if a.status != "draft":
        raise HTTPException(409, "Your application has been submitted, so the ID can't change.")
    mime = (file.content_type or "").split(";")[0]
    if mime not in ACCEPTED:
        raise HTTPException(422, "Use a JPG, PNG or PDF file.")
    data = await file.read()
    limit = get_settings().document_max_mb
    if not data:
        raise HTTPException(422, "That file is empty.")
    if len(data) > limit * 1024 * 1024:
        raise HTTPException(
            413, f"That file is bigger than {limit} MB. Take a new photo, or send a smaller file."
        )
    key = f"applications/{a.id}/national-id-{uuid.uuid4().hex[:12]}.{ACCEPTED[mime]}"
    storage.put(get_settings().s3_bucket_documents, key, data, mime)
    kind, what = device_of(user_agent)
    doc = Document(
        application_id=a.id,
        handoff_id=handoff.id if handoff else None,
        kind="national_id",
        status="uploaded",
        object_key=key,
        mime_type=mime,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).digest(),
        capture_device=f"{kind} ({what})" if what else kind,
    )
    db.add(doc)
    # Starting again un-confirms the ID until the new photo is checked.
    a.person.national_id_enc = a.person.national_id_hmac = None
    a.person.national_id_masked = a.person.national_id_valid = None
    a.updated_at = clock.now()
    await db.commit()
    return doc


class ConfirmIdIn(BaseModel):
    id_number: str = Field(max_length=32)
    surname: str = Field(min_length=1, max_length=80)
    first_names: str = Field(min_length=1, max_length=120)
    date_of_birth: date


def _title(s: str) -> str:
    return " ".join(w.capitalize() for w in s.split())


async def _confirm(db: AsyncSession, a: Application, body: ConfirmIdIn) -> None:
    if a.status != "draft":
        raise HTTPException(409, "Your application has been submitted, so the ID can't change.")
    d = decode(body.id_number)
    if d is None:
        raise HTTPException(422, "Enter the ID number as it's printed, like 63-2047823 C 29.")
    if not d.check_letter_valid:
        raise HTTPException(
            422, "The letter after the digits doesn't match the ID number. Check it on your ID."
        )
    age = (clock.today() - body.date_of_birth).days // 365
    if not 14 <= age <= 90:
        raise HTTPException(422, "Check the date of birth.")
    digest = crypto.keyed_hash(d.normalized.replace(" ", "").replace("-", ""))
    other = await db.scalar(
        select(Person.id).where(Person.national_id_hmac == digest, Person.id != a.person_id)
    )
    if other:
        raise HTTPException(
            409, "This ID number is already on another account. Contact Admissions so they can help."
        )
    p = a.person
    p.national_id_enc = crypto.encrypt(d.normalized)
    p.national_id_hmac = digest
    p.national_id_masked = f"{d.normalized[:5]}•••••{d.normalized[-4:]}"
    p.national_id_valid = True
    p.id_reg_district, p.id_origin_district = d.reg_code, d.origin_code
    p.surname, p.first_names, p.date_of_birth = (
        _title(body.surname),
        _title(body.first_names),
        body.date_of_birth,
    )
    doc = _latest_id_doc(a)
    if doc:
        confirmed = {
            "national_id": d.normalized,
            "surname": body.surname.strip().upper(),
            "first_names": body.first_names.strip().upper(),
            "date_of_birth": body.date_of_birth.isoformat(),
        }
        rows = await db.execute(select(DocumentField).where(DocumentField.document_id == doc.id))
        existing = {f.field: f for f in rows.scalars()}
        for k, v in confirmed.items():
            if k in existing:
                existing[k].confirmed_value = v
            else:
                db.add(DocumentField(document_id=doc.id, field=k, confirmed_value=v))
        doc.status = "confirmed"
    a.updated_at = clock.now()
    await db.commit()


# --- on the computer (or a phone signed in as the applicant) ------------------------------------


async def _draft(db: AsyncSession, cu: CurrentUser) -> Application:
    a = await _current(db, await _person(db, cu))
    if a is None:
        raise HTTPException(409, "Choose a programme first.")
    return a


@router.get("/apply/national-id")
async def national_id(
    cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> NationalIdState:
    return await id_state(db, await _draft(db, cu))


@router.post("/apply/national-id")
async def upload_national_id(
    request: Request,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    cu: CurrentUser = Depends(applicant),
    db: AsyncSession = Depends(get_db),
) -> NationalIdState:
    a = await _draft(db, cu)
    doc = await _upload(db, a, file, request.headers.get("user-agent"), None)
    background.add_task(_read_document, doc.id)
    await db.refresh(a, ["documents", "person"])
    return await id_state(db, a)


@router.put("/apply/national-id")
async def confirm_national_id(
    body: ConfirmIdIn, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> NationalIdState:
    a = await _draft(db, cu)
    await _confirm(db, a, body)
    await db.refresh(a, ["documents", "person"])
    return await id_state(db, a)


# --- handoff: the computer's side ---------------------------------------------------------------


class HandoffState(StrEnum):
    waiting = "waiting"  # link shown, no phone yet
    connected = "connected"
    expired = "expired"  # nobody claimed it in time
    ended = "ended"  # disconnected, or the phone's session ran out


class HandoffOut(BaseModel):
    state: HandoffState
    match_code: str
    claim_expires_at: datetime
    device: str | None
    connected_at: datetime | None
    national_id: NationalIdState
    results_started: bool


class NewHandoff(HandoffOut):
    code: str  # "K7Q2-9MXD": shown once, never stored
    token: str  # for the QR code


def _hash(s: str) -> bytes:
    return hashlib.sha256(s.upper().encode()).digest()


def _state(h: DeviceHandoff, now: datetime) -> HandoffState:
    if h.revoked_at:
        return HandoffState.ended
    if h.claimed_at:
        return (
            HandoffState.connected
            if h.session_expires_at and h.session_expires_at > now
            else HandoffState.ended
        )
    return HandoffState.waiting if h.claim_expires_at > now else HandoffState.expired


async def _handoff_out(db: AsyncSession, h: DeviceHandoff) -> HandoffOut:
    a = h.application
    await db.refresh(a, ["documents", "person", "sittings"])
    return HandoffOut(
        state=_state(h, clock.now()),
        match_code=h.match_code,
        claim_expires_at=h.claim_expires_at,
        device=(device_of(h.claimed_user_agent)[1] or None) if h.claimed_at else None,
        connected_at=h.claimed_at,
        national_id=await id_state(db, a),
        results_started=bool(a.sittings),
    )


async def _latest_handoff(db: AsyncSession, a: Application) -> DeviceHandoff | None:
    return (
        (
            await db.execute(
                select(DeviceHandoff)
                .where(DeviceHandoff.application_id == a.id)
                .order_by(DeviceHandoff.created_at.desc())
            )
        )
        .scalars()
        .first()
    )


class StartHandoffIn(BaseModel):
    start_step: str = "national_id"


@router.post("/apply/handoffs")
async def start_handoff(
    body: StartHandoffIn, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> NewHandoff:
    """A new link; any earlier one stops working."""
    a = await _draft(db, cu)
    if a.status != "draft":
        raise HTTPException(409, "Your application has been submitted.")
    now = clock.now()
    old = await _latest_handoff(db, a)
    if old and not old.revoked_at:
        old.revoked_at = now
    match = "".join(secrets.choice(ALPHABET) for _ in range(4))
    code = match + "-" + "".join(secrets.choice(ALPHABET) for _ in range(4))
    token = crypto.random_token(24)
    h = DeviceHandoff(
        application_id=a.id,
        created_by=cu.user.id,
        token_hash=_hash(token),
        short_code_hash=_hash(code),
        match_code=match,
        start_step=body.start_step,
        sent_via="qr",
        claim_expires_at=now + timedelta(minutes=get_settings().handoff_claim_minutes),
    )
    db.add(h)
    await db.commit()
    await db.refresh(h, ["application"])
    out = await _handoff_out(db, h)
    return NewHandoff(**out.model_dump(), code=code, token=token)


@router.get("/apply/handoffs/current")
async def current_handoff(
    cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> HandoffOut | None:
    """Polled by the computer while the phone works (design/HandoffWaiting)."""
    h = await _latest_handoff(db, await _draft(db, cu))
    return await _handoff_out(db, h) if h else None


class SendLinkIn(BaseModel):
    code: str


class LinkSent(BaseModel):
    sms_queued: bool


@router.post("/apply/handoffs/current/sms")
async def send_handoff_link(
    body: SendLinkIn, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> LinkSent:
    h = await _latest_handoff(db, await _draft(db, cu))
    if h is None or _state(h, clock.now()) != HandoffState.waiting or h.short_code_hash != _hash(body.code):
        raise HTTPException(409, "This link has expired. Create a new one.")
    if not cu.user.phone:
        raise HTTPException(409, "There's no verified phone number on your account.")
    link = f"{get_settings().app_url.rstrip('/')}/h/{body.code.upper()}"
    n = Notification(
        user_id=cu.user.id,
        category="application",
        title="Continue your TCFL application on this phone",
        body=f"Open {link} . Check the code matches your computer screen.",
        link=f"/h/{body.code.upper()}",
        dedupe_key=f"handoff:{h.id}",
    )
    db.add(n)
    db.add(NotificationDelivery(notification=n, channel="sms", status="queued"))
    h.sent_via = "sms"
    await db.commit()
    return LinkSent(sms_queued=True)


@router.post("/apply/handoffs/current/disconnect")
async def disconnect_handoff(
    cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> HandoffOut:
    h = await _latest_handoff(db, await _draft(db, cu))
    if h is None:
        raise HTTPException(404, "There's no phone linked.")
    if not h.revoked_at:
        h.revoked_at = clock.now()
        await db.commit()
    return await _handoff_out(db, h)


# --- handoff: the phone's side ------------------------------------------------------------------


class LandingState(StrEnum):
    ready = "ready"
    yours = "yours"  # this phone already joined
    expired = "expired"
    closed = "closed"  # disconnected, reported, or claimed by another phone


class HandoffLanding(BaseModel):
    state: LandingState
    first_name: str
    programme: str
    step: str
    start_step: str
    match_code: str


async def _by_code(db: AsyncSession, code: str) -> DeviceHandoff:
    digest = _hash(code.strip())
    h = (
        await db.execute(
            select(DeviceHandoff).where(
                (DeviceHandoff.short_code_hash == digest) | (DeviceHandoff.token_hash == digest)
            )
        )
    ).scalar_one_or_none()
    if h is None:
        raise HTTPException(404, "This link doesn't work. Check it, or create a new one on your computer.")
    return h


def _mine(h: DeviceHandoff, request: Request) -> bool:
    cookie = request.cookies.get(HANDOFF_COOKIE)
    return bool(cookie and h.session_hash and crypto.sha256(cookie) == h.session_hash)


STEP_LABEL = {
    "national_id": "Step 2 of 6, National ID",
    "birth_certificate": "Step 3 of 6, Birth certificate",
    "results": "Step 4 of 6, ZIMSEC results",
}


@router.get("/handoff/{code}")
async def handoff_landing(code: str, request: Request, db: AsyncSession = Depends(get_db)) -> HandoffLanding:
    h = await _by_code(db, code)
    now = clock.now()
    s = _state(h, now)
    if s == HandoffState.connected:
        state = LandingState.yours if _mine(h, request) else LandingState.closed
    else:
        state = {HandoffState.waiting: LandingState.ready, HandoffState.expired: LandingState.expired}.get(
            s, LandingState.closed
        )
    a = h.application
    return HandoffLanding(
        state=state,
        first_name=a.person.given_name,
        programme=a.programme.name,
        step=STEP_LABEL.get(h.start_step, "National ID"),
        start_step=h.start_step,
        match_code=h.match_code,
    )


class Claimed(BaseModel):
    ok: bool


@router.post("/handoff/{code}/claim")
async def claim_handoff(
    code: str, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> Claimed:
    h = await _by_code(db, code)
    now = clock.now()
    if _mine(h, request) and _state(h, now) == HandoffState.connected:
        return Claimed(ok=True)
    if _state(h, now) != HandoffState.waiting:
        raise HTTPException(
            409, "This link has expired or was already used. Create a new one on your computer."
        )
    secret = crypto.random_token(32)
    s = get_settings()
    h.claimed_at = now
    h.claimed_user_agent = request.headers.get("user-agent", "")[:300]
    h.claimed_ip = request.client.host if request.client else None
    h.session_hash = crypto.sha256(secret)
    h.session_expires_at = now + timedelta(hours=s.handoff_session_hours)
    await db.commit()
    response.set_cookie(
        HANDOFF_COOKIE,
        secret,
        httponly=True,
        secure=s.is_prod,
        samesite="strict",
        max_age=s.handoff_session_hours * 3600,
        path="/",
    )
    return Claimed(ok=True)


@router.post("/handoff/{code}/mismatch")
async def report_mismatch(code: str, db: AsyncSession = Depends(get_db)) -> Claimed:
    """The codes didn't match: close the link so nothing can be added through it (design/CodesMismatch)."""
    h = await _by_code(db, code)
    now = clock.now()
    if not h.revoked_at:
        h.revoked_at = now
        db.add(
            ApplicationFlag(
                application_id=h.application_id,
                code="HANDOFF_CODE_MISMATCH",
                severity="low",
                detail={"text": "A phone link was closed because the codes didn't match"},
            )
        )
        await db.commit()
    return Claimed(ok=True)


async def phone_session(request: Request, db: AsyncSession = Depends(get_db)) -> DeviceHandoff:
    cookie = request.cookies.get(HANDOFF_COOKIE)
    h = None
    if cookie:
        h = (
            await db.execute(select(DeviceHandoff).where(DeviceHandoff.session_hash == crypto.sha256(cookie)))
        ).scalar_one_or_none()
    if h is None or _state(h, clock.now()) != HandoffState.connected:
        raise HTTPException(410, "Your computer ended this session.")
    return h


class PhoneSession(BaseModel):
    first_name: str
    programme: str
    match_code: str
    national_id: NationalIdState
    results_started: bool


@router.get("/handoff/session/current")
async def phone_state(
    h: DeviceHandoff = Depends(phone_session), db: AsyncSession = Depends(get_db)
) -> PhoneSession:
    out = await _handoff_out(db, h)
    a = h.application
    return PhoneSession(
        first_name=a.person.given_name,
        programme=a.programme.name,
        match_code=h.match_code,
        national_id=out.national_id,
        results_started=out.results_started,
    )


@router.post("/handoff/session/national-id")
async def phone_upload_national_id(
    request: Request,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    h: DeviceHandoff = Depends(phone_session),
    db: AsyncSession = Depends(get_db),
) -> NationalIdState:
    a = h.application
    doc = await _upload(db, a, file, request.headers.get("user-agent"), h)
    background.add_task(_read_document, doc.id)
    await db.refresh(a, ["documents", "person"])
    return await id_state(db, a)


@router.put("/handoff/session/national-id")
async def phone_confirm_national_id(
    body: ConfirmIdIn, h: DeviceHandoff = Depends(phone_session), db: AsyncSession = Depends(get_db)
) -> NationalIdState:
    a = h.application
    await _confirm(db, a, body)
    await db.refresh(a, ["documents", "person"])
    return await id_state(db, a)
