"""Step 6 · Submit: the declaration, the application fee, and sending the application to Admissions
(design/Submit, SubmitDesktop, Payment, PayWaiting, PayFailed, PayOffice, Submitted)."""

import hashlib
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crypto, storage
from app.api.apply import ApplicantDep, _out, add_working_days
from app.api.apply_id import ACCEPTED, _draft
from app.api.apply_review import explain
from app.auth.deps import CurrentUser, require_role
from app.config import get_settings
from app.db import DbDep
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationPayment,
    Document,
    Notification,
    NotificationDelivery,
    Person,
)
from app.pdf import make_pdf
from app.services import audit, clock, eligibility, payments
from app.services.phones import local_phone, to_e164

router = APIRouter(tags=["apply submit"])
staff_router = APIRouter(prefix="/staff/accounts", tags=["accounts"])
# Accounts match bank transfers and cash against the statement and cash book.
accounts = require_role("accounts", "admin")
AccountsDep = Annotated[CurrentUser, Depends(accounts)]
SESSION = {"JUNE": "June", "NOVEMBER": "November"}


class PayMethod(StrEnum):
    ecocash = "ecocash"
    onemoney = "onemoney"
    bank = "bank"
    cash = "cash"


class PayStatus(StrEnum):
    awaiting_approval = "awaiting_approval"
    paid = "paid"
    failed = "failed"
    expired = "expired"
    awaiting_confirmation = "awaiting_confirmation"
    cancelled = "cancelled"


LABEL = {"ecocash": "EcoCash", "onemoney": "OneMoney", "bank": "Bank transfer", "cash": "Cash"}


def _money(v) -> str:
    return f"{Decimal(v):.2f}"


# --- state -----------------------------------------------------------------------------------------


class PaymentOut(BaseModel):
    id: uuid.UUID
    method: PayMethod
    status: PayStatus
    amount: str
    phone_masked: str | None  # "077 ••• 4521"
    receipt: str | None
    failure: str | None
    expires_at: datetime | None
    paid_at: datetime | None
    has_proof: bool
    created_at: datetime


class MethodOption(BaseModel):
    method: PayMethod
    available: bool
    note: str  # "Approve on your phone. Done in about a minute."


class BankDetails(BaseModel):
    account_name: str
    bank: str
    account_number: str
    branch: str | None


class SummaryRow(BaseModel):
    label: str
    value: str
    mono: bool
    step: str


class SubmitState(BaseModel):
    reference: str
    status: str
    summary: list[SummaryRow]
    ready: bool  # every step done and the entry requirements met
    declared: bool
    fee: str
    methods: list[MethodOption]
    provider: str | None  # who processes mobile money
    phone: str | None  # the account's number, as a starting point for EcoCash
    bank: BankDetails | None
    accounts_office: str
    confirm_days: int
    payment: PaymentOut | None


def _payment_out(p: ApplicationPayment | None) -> PaymentOut | None:
    if p is None:
        return None
    local = local_phone(p.phone)
    return PaymentOut(
        id=p.id,
        method=PayMethod(p.method),
        status=PayStatus(p.status),
        amount=_money(p.amount),
        phone_masked=f"{local[:3]} ••• {local[-4:]}" if local else None,
        receipt=p.receipt,
        failure=p.failure,
        expires_at=p.expires_at,
        paid_at=p.paid_at,
        has_proof=p.proof_document_id is not None,
        created_at=p.created_at,
    )


async def _latest_payment(db: AsyncSession, a: Application) -> ApplicationPayment | None:
    return (
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


async def _ready(db: AsyncSession, a: Application) -> bool:
    out = await _out(db, a)
    s = out.steps
    e = explain(a)
    return s.national_id and s.birth_certificate and s.results and bool(e and e.eligible)


async def _state(db: AsyncSession, a: Application) -> SubmitState:
    s = get_settings()
    gw = payments.provider()
    mobile = gw is not None
    bank = (
        BankDetails(
            account_name=s.bank_account_name or s.college_name,
            bank=s.bank_name,
            account_number=s.bank_account_number,
            branch=s.bank_branch or None,
        )
        if s.bank_name and s.bank_account_number
        else None
    )
    p = a.person
    sittings = sorted(a.sittings, key=lambda x: (x.year, x.session == "NOVEMBER"))
    n = len({r.subject_name for x in sittings for r in x.results})
    when = ", ".join(f"{SESSION.get(x.session, x.session)} {x.year}" for x in sittings)
    summary = [SummaryRow(label="Programme", value=a.programme.name, mono=False, step="programme")]
    if p.national_id_enc:
        summary.append(
            SummaryRow(
                label="National ID", value=crypto.decrypt(p.national_id_enc), mono=True, step="national_id"
            )
        )
    if sittings:
        summary.append(
            SummaryRow(
                label="ZIMSEC results",
                value=f"{n} {'subject' if n == 1 else 'subjects'} · {when}",
                mono=False,
                step="results",
            )
        )
    return SubmitState(
        reference=a.reference or "",
        status=a.status,
        summary=summary,
        ready=await _ready(db, a),
        declared=a.declared_at is not None,
        fee=_money(s.application_fee_usd),
        methods=[
            MethodOption(
                method=PayMethod.ecocash,
                available=mobile,
                note="Approve on your phone. Done in about a minute.",
            ),
            MethodOption(method=PayMethod.onemoney, available=mobile, note="Approve on your NetOne phone"),
            MethodOption(
                method=PayMethod.bank,
                available=bank is not None,
                note=f"Takes 1–{s.bank_confirm_working_days} working days to confirm",
            ),
            MethodOption(
                method=PayMethod.cash, available=True, note=f"{s.accounts_office}. Bring your reference."
            ),
        ],
        provider=gw.label if gw else None,
        phone=local_phone(p.user.phone if p.user else None),
        bank=bank,
        accounts_office=s.accounts_office,
        confirm_days=s.bank_confirm_working_days,
        payment=_payment_out(await _latest_payment(db, a)),
    )


async def submit_application(db: AsyncSession, a: Application, payment: ApplicationPayment) -> None:
    """The fee is paid: send the application to Admissions, and tell the applicant."""
    if a.status != "draft":
        return
    now = clock.now()
    e = eligibility.evaluate(
        a.programme.entry_rules or {},
        eligibility.best_grades(
            [[(r.subject_name, r.grade) for r in s.results] for s in a.sittings if s.level == "O"]
        ),
    )
    a.status, a.submitted_at, a.updated_at = "submitted", now, now
    a.eligibility = "eligible" if e.eligible else "not_eligible"
    a.eligibility_detail = {"summary": e.summary, "rows": [r.__dict__ for r in e.rows]}
    db.add(
        ApplicationEvent(
            application_id=a.id,
            actor_id=a.person.user_id,
            kind="status",
            from_status="draft",
            to_status="submitted",
            comment=f"Fee paid: US$ {_money(payment.amount)} · {LABEL[payment.method]}"
            + (f" · receipt {payment.receipt}" if payment.receipt else ""),
        )
    )
    user = a.person.user
    if user:
        n = Notification(
            user_id=user.id,
            category="application",
            title=f"Application {a.reference} received",
            body=f"{get_settings().college_name}: we've received your application {a.reference} "
            f"for the {a.programme.name}. We'll text you when there's a decision.",
            link="/apply/status",
            dedupe_key=f"application:{a.id}:submitted",
        )
        db.add(n)
        if user.phone:
            db.add(NotificationDelivery(notification=n, channel="sms", status="queued"))


async def _refresh_mobile(db: AsyncSession, a: Application, p: ApplicationPayment | None) -> None:
    """Ask the gateway how a prompt is going; a payment that went through submits the application."""
    if p is None or p.status != "awaiting_approval":
        return
    gw = payments.provider()
    now = clock.now()
    if gw is None:
        return
    st = gw.status(p.provider_ref or "", p.phone or "", p.created_at)
    if st.state == "paid":
        p.status, p.paid_at, p.receipt = "paid", now, st.receipt
        await submit_application(db, a, p)
    elif st.state == "failed":
        p.status, p.failure = "failed", st.failure
    elif p.expires_at and now > p.expires_at:
        p.status, p.failure = "expired", "the prompt wasn't approved in time"
    await db.commit()


# --- the applicant ---------------------------------------------------------------------------------


@router.get("/apply/submit")
async def submit_state(cu: ApplicantDep, db: DbDep) -> SubmitState:
    a = await _draft(db, cu)
    await _refresh_mobile(db, a, await _latest_payment(db, a))
    await db.refresh(a)
    return await _state(db, a)


class DeclarationIn(BaseModel):
    agree: bool


@router.post("/apply/declaration")
async def declare(body: DeclarationIn, cu: ApplicantDep, db: DbDep) -> SubmitState:
    a = await _draft(db, cu)
    if a.status != "draft":
        raise HTTPException(409, "Your application has already been submitted.")
    if not body.agree:
        raise HTTPException(422, "Tick the box to confirm your details are true")
    if not await _ready(db, a):
        raise HTTPException(409, "Finish every step, and check the entry requirements, before you submit.")
    a.declared_at = a.declared_at or clock.now()
    await db.commit()
    return await _state(db, a)


class PayIn(BaseModel):
    method: PayMethod
    phone: str | None = Field(default=None, max_length=20)


@router.post("/apply/payments")
async def start_payment(body: PayIn, cu: ApplicantDep, db: DbDep) -> SubmitState:
    """Mobile money: send the prompt. Bank or cash: "I've paid", for Accounts to confirm."""
    a = await _draft(db, cu)
    if a.status != "draft":
        raise HTTPException(409, "Your application has already been submitted.")
    if a.declared_at is None:
        raise HTTPException(409, "Confirm the declaration first.")
    s = get_settings()
    last = await _latest_payment(db, a)
    if last and last.status == "paid":
        raise HTTPException(409, "The fee is already paid.")
    if last and last.status in ("awaiting_approval", "awaiting_confirmation"):
        last.status = "cancelled"
    now = clock.now()
    p = ApplicationPayment(
        application_id=a.id, method=body.method, amount=Decimal(s.application_fee_usd), created_at=now
    )
    if body.method in (PayMethod.ecocash, PayMethod.onemoney):
        gw = payments.provider()
        if gw is None:
            raise HTTPException(
                409, "Paying by mobile money isn't available yet. Pay by bank transfer or cash."
            )
        phone = to_e164(body.phone or "")
        if phone is None:
            raise HTTPException(422, "Enter your mobile number, like 077 318 4521.")
        p.phone, p.provider = phone, gw.name
        p.provider_ref = gw.push(phone, _money(p.amount), a.reference or "").ref
        p.status = "awaiting_approval"
        p.expires_at = now + timedelta(seconds=s.payment_prompt_seconds)
    else:
        if body.method == PayMethod.bank and not (s.bank_name and s.bank_account_number):
            raise HTTPException(409, "Bank transfer isn't available yet. Pay by cash at the Accounts Office.")
        p.status = "awaiting_confirmation"
    db.add(p)
    await db.commit()
    return await _state(db, a)


@router.post("/apply/payments/current/cancel")
async def cancel_payment(cu: ApplicantDep, db: DbDep) -> SubmitState:
    """ "Pay another way": stop waiting for this prompt."""
    a = await _draft(db, cu)
    p = await _latest_payment(db, a)
    if p and p.status in ("awaiting_approval", "awaiting_confirmation"):
        p.status = "cancelled"
        await db.commit()
    return await _state(db, a)


@router.post("/apply/payments/current/proof")
async def upload_proof(cu: ApplicantDep, db: DbDep, file: Annotated[UploadFile, File()]) -> SubmitState:
    a = await _draft(db, cu)
    p = await _latest_payment(db, a)
    if p is None or p.status != "awaiting_confirmation" or p.method != "bank":
        raise HTTPException(409, "Choose bank transfer and tap I've paid first.")
    mime = (file.content_type or "").split(";")[0]
    if mime not in ACCEPTED:
        raise HTTPException(422, "Use a JPG, PNG or PDF file.")
    data = await file.read()
    if not data or len(data) > get_settings().document_max_mb * 1024 * 1024:
        raise HTTPException(413, f"Use a file up to {get_settings().document_max_mb} MB.")
    key = f"applications/{a.id}/payment-proof-{uuid.uuid4().hex[:12]}.{ACCEPTED[mime]}"
    await storage.put(get_settings().s3_bucket_documents, key, data, mime)
    d = Document(
        application_id=a.id,
        kind="payment_proof",
        status="uploaded",
        object_key=key,
        mime_type=mime,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).digest(),
    )
    db.add(d)
    await db.flush()
    p.proof_document_id = d.id
    await db.commit()
    return await _state(db, a)


@router.get("/apply/application.pdf", response_class=Response)
async def application_copy(cu: ApplicantDep, db: DbDep) -> Response:
    """design/Submitted "Download a copy"."""
    a = await _draft(db, cu)
    p = a.person
    lines = [
        f"Reference {a.reference}",
        f"{p.first_names} {p.surname}",
        f"Programme: {a.programme.name} · {a.intake.name}",
    ]
    if p.national_id_enc:
        lines.append(f"National ID: {crypto.decrypt(p.national_id_enc)}")
    if a.submitted_at:
        lines.append(f"Submitted: {a.submitted_at.astimezone(clock.tz()):%d %B %Y, %H:%M}")
    for s in sorted(a.sittings, key=lambda x: (x.year, x.session == "NOVEMBER")):
        sitting = f"{s.level}-Level {SESSION.get(s.session, s.session)} {s.year}"
        lines.append(f"{sitting}, centre {s.centre_number}, candidate {s.candidate_number}")
        lines += [f"    {r.subject_code or '    '}  {r.subject_name}  {r.grade}" for r in s.results]
    pdf = make_pdf(f"{get_settings().college_name}: application", lines)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(f'Application {a.reference}.pdf')}"
        },
    )


# --- Accounts: bank and cash payments to confirm --------------------------------------------------


class PaymentToConfirm(BaseModel):
    id: uuid.UUID
    reference: str
    name: str
    method: PayMethod
    amount: str
    created_at: datetime
    proof_document_id: uuid.UUID | None
    expected_by: datetime


@staff_router.get("/payments")
async def payments_to_confirm(_: AccountsDep, db: DbDep) -> list[PaymentToConfirm]:
    rows = (
        (
            await db.execute(
                select(ApplicationPayment, Application, Person)
                .join(Application, Application.id == ApplicationPayment.application_id)
                .join(Person, Person.id == Application.person_id)
                .where(ApplicationPayment.status == "awaiting_confirmation")
                .order_by(ApplicationPayment.created_at)
            )
        )
        .unique()
        .all()
    )
    days = get_settings().bank_confirm_working_days
    return [
        PaymentToConfirm(
            id=p.id,
            reference=a.reference or "",
            name=f"{person.first_names} {person.surname}",
            method=PayMethod(p.method),
            amount=_money(p.amount),
            created_at=p.created_at,
            proof_document_id=p.proof_document_id,
            expected_by=clock.at(
                add_working_days(p.created_at.astimezone(clock.tz()).date(), days),
                p.created_at.astimezone(clock.tz()).time(),
            ),
        )
        for p, a, person in rows
    ]


@staff_router.get("/payments/{payment_id}/proof", response_class=StreamingResponse)
async def payment_proof(
    payment_id: uuid.UUID,
    request: Request,
    cu: AccountsDep,
    db: DbDep,
) -> StreamingResponse:
    p = await db.get(ApplicationPayment, payment_id)
    d = await db.get(Document, p.proof_document_id) if p and p.proof_document_id else None
    bucket = get_settings().s3_bucket_documents
    if d is None or await storage.size(bucket, d.object_key) is None:
        raise HTTPException(404, "There's no proof of payment for this.")
    await audit.record(db, cu, request, "document.view", "document", str(d.id), {"kind": d.kind})
    await db.commit()
    return StreamingResponse(storage.stream(bucket, d.object_key), media_type=d.mime_type)


class ConfirmPaymentIn(BaseModel):
    receipt: str = Field(min_length=1, max_length=40)


class RejectPaymentIn(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


async def _payment(db: AsyncSession, payment_id: uuid.UUID) -> tuple[ApplicationPayment, Application]:
    p = await db.get(ApplicationPayment, payment_id)
    if p is None or p.status != "awaiting_confirmation":
        raise HTTPException(409, "This payment isn't waiting for confirmation.")
    return p, await db.get_one(Application, p.application_id)


@staff_router.post("/payments/{payment_id}/confirm")
async def confirm_payment(
    payment_id: uuid.UUID,
    body: ConfirmPaymentIn,
    request: Request,
    cu: AccountsDep,
    db: DbDep,
) -> list[PaymentToConfirm]:
    p, a = await _payment(db, payment_id)
    await audit.record(
        db, cu, request, "payment.confirm", "payment", str(p.id), {"receipt": body.receipt.strip()}
    )
    p.status, p.paid_at, p.receipt, p.confirmed_by = "paid", clock.now(), body.receipt.strip(), cu.user.id
    await submit_application(db, a, p)
    await db.commit()
    return await payments_to_confirm(cu, db)


@staff_router.post("/payments/{payment_id}/reject")
async def reject_payment(
    payment_id: uuid.UUID,
    body: RejectPaymentIn,
    request: Request,
    cu: AccountsDep,
    db: DbDep,
) -> list[PaymentToConfirm]:
    p, a = await _payment(db, payment_id)
    await audit.record(db, cu, request, "payment.reject", "payment", str(p.id))
    p.status, p.failure, p.confirmed_by = "failed", body.reason.strip(), cu.user.id
    user = a.person.user
    if user:
        n = Notification(
            user_id=user.id,
            category="application",
            title=f"We couldn't find your payment for {a.reference}",
            body=body.reason.strip(),
            link="/apply/pay",
            dedupe_key=f"payment:{p.id}:rejected",
        )
        db.add(n)
        if user.phone:
            db.add(NotificationDelivery(notification=n, channel="sms", status="queued"))
    await db.commit()
    return await payments_to_confirm(cu, db)
