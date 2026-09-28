"""Step 3 · Birth certificate. A photo or scan, plus the name and date of birth as printed, which the
applicant confirms; they're compared with the National ID for Admissions. No design yet: the
screens follow the National ID step. Not read by OCR: layouts vary too much to be worth it."""

import hashlib
import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.api.apply import ApplicantDep
from app.api.apply_id import ACCEPTED, PhoneDep, _draft, device_of
from app.config import get_settings
from app.db import DbDep
from app.models import Application, ApplicationEvent, ApplicationFlag, DeviceHandoff, Document, DocumentField
from app.services import clock
from app.services.names import name_words

router = APIRouter(tags=["apply birth certificate"])
KIND = "birth_certificate"


class BirthStatus(StrEnum):
    none = "none"
    uploaded = "uploaded"  # photo in, details not confirmed yet
    confirmed = "confirmed"


class BirthCertificateState(BaseModel):
    status: BirthStatus
    document_id: uuid.UUID | None
    received_at: datetime | None
    capture_device: str | None
    # As printed on the certificate; before confirming, the ID's details as a starting point.
    name: str | None
    date_of_birth: date | None
    matches_id: bool | None


def _latest(a: Application) -> Document | None:
    docs = [d for d in a.documents if d.kind == KIND]
    return max(docs, key=lambda d: d.created_at) if docs else None


def _matches(a: Application, name: str, dob: date) -> bool | None:
    p = a.person
    if p.national_id_enc is None:
        return None
    return name_words(name) == name_words(f"{p.first_names} {p.surname}") and dob == p.date_of_birth


async def birth_state(db: AsyncSession, a: Application) -> BirthCertificateState:
    d = _latest(a)
    p = a.person
    id_name = f"{p.first_names} {p.surname}".upper() if p.national_id_enc else None
    if d is None:
        return BirthCertificateState(
            status=BirthStatus.none,
            document_id=None,
            received_at=None,
            capture_device=None,
            name=id_name,
            date_of_birth=p.date_of_birth,
            matches_id=None,
        )
    rows = await db.execute(select(DocumentField).where(DocumentField.document_id == d.id))
    f = {x.field: x.confirmed_value for x in rows.scalars()}
    confirmed = d.status in ("confirmed", "approved")
    name = f.get("full_name") if confirmed else id_name
    dob = (
        date.fromisoformat(printed) if confirmed and (printed := f.get("date_of_birth")) else p.date_of_birth
    )
    return BirthCertificateState(
        status=BirthStatus.confirmed if confirmed else BirthStatus.uploaded,
        document_id=d.id,
        received_at=d.created_at,
        capture_device=d.capture_device,
        name=name,
        date_of_birth=dob,
        matches_id=_matches(a, name, dob) if confirmed and name and dob else None,
    )


async def _upload(
    db: AsyncSession, a: Application, file: UploadFile, user_agent: str | None, handoff: DeviceHandoff | None
) -> None:
    if a.status != "draft":
        raise HTTPException(
            409, "Your application has been submitted, so the birth certificate can't change."
        )
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
    key = f"applications/{a.id}/birth-certificate-{uuid.uuid4().hex[:12]}.{ACCEPTED[mime]}"
    await storage.put(get_settings().s3_bucket_documents, key, data, mime)
    kind, what = device_of(user_agent)
    db.add(
        Document(
            application_id=a.id,
            handoff_id=handoff.id if handoff else None,
            kind=KIND,
            status="uploaded",
            object_key=key,
            mime_type=mime,
            size_bytes=len(data),
            sha256=hashlib.sha256(data).digest(),
            capture_device=f"{kind} ({what})" if what else kind,
        )
    )
    a.updated_at = clock.now()
    await db.commit()


class ConfirmBirthIn(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    date_of_birth: date


async def _confirm(db: AsyncSession, a: Application, body: ConfirmBirthIn) -> None:
    if a.status != "draft":
        raise HTTPException(
            409, "Your application has been submitted, so the birth certificate can't change."
        )
    d = _latest(a)
    if d is None:
        raise HTTPException(409, "Add a photo of your birth certificate first.")
    if not 14 <= (clock.today() - body.date_of_birth).days // 365 <= 90:
        raise HTTPException(422, "Check the date of birth.")
    name = " ".join(body.name.upper().split())
    await db.execute(delete(DocumentField).where(DocumentField.document_id == d.id))
    db.add_all(
        [
            DocumentField(document_id=d.id, field="full_name", confirmed_value=name),
            DocumentField(
                document_id=d.id, field="date_of_birth", confirmed_value=body.date_of_birth.isoformat()
            ),
        ]
    )
    d.status = "confirmed"
    d.updated_at = clock.now()
    db.add(
        ApplicationEvent(
            application_id=a.id,
            kind="document",
            comment="Birth certificate added",
            via=(d.capture_device or "").split(" ")[0] or None,
        )
    )
    # For Admissions: the certificate should agree with the ID (a changed surname is a common reason).
    open_flag = next((f for f in a.flags if f.code == "BIRTH_CERT_MISMATCH" and not f.resolved_at), None)
    if _matches(a, name, body.date_of_birth) is False:
        if open_flag is None:
            db.add(
                ApplicationFlag(
                    application_id=a.id,
                    document_id=d.id,
                    code="BIRTH_CERT_MISMATCH",
                    severity="medium",
                    detail={"text": "Birth certificate differs from ID"},
                )
            )
    elif open_flag is not None:
        await db.delete(open_flag)
    a.updated_at = clock.now()
    await db.commit()


async def _fresh(db: AsyncSession, a: Application) -> BirthCertificateState:
    await db.refresh(a, ["documents", "person", "flags"])
    return await birth_state(db, a)


# --- the applicant ------------------------------------------------------------------------------


@router.get("/apply/birth-certificate")
async def birth_certificate(cu: ApplicantDep, db: DbDep) -> BirthCertificateState:
    return await birth_state(db, await _draft(db, cu))


@router.post("/apply/birth-certificate")
async def upload_birth_certificate(
    request: Request,
    cu: ApplicantDep,
    db: DbDep,
    file: Annotated[UploadFile, File()],
) -> BirthCertificateState:
    a = await _draft(db, cu)
    await _upload(db, a, file, request.headers.get("user-agent"), None)
    return await _fresh(db, a)


@router.put("/apply/birth-certificate")
async def confirm_birth_certificate(
    body: ConfirmBirthIn, cu: ApplicantDep, db: DbDep
) -> BirthCertificateState:
    a = await _draft(db, cu)
    await _confirm(db, a, body)
    return await _fresh(db, a)


# --- a linked phone -------------------------------------------------------------------------------


@router.get("/handoff/session/birth-certificate")
async def phone_birth_certificate(h: PhoneDep, db: DbDep) -> BirthCertificateState:
    return await _fresh(db, h.application)


@router.post("/handoff/session/birth-certificate")
async def phone_upload_birth_certificate(
    request: Request,
    h: PhoneDep,
    db: DbDep,
    file: Annotated[UploadFile, File()],
) -> BirthCertificateState:
    await _upload(db, h.application, file, request.headers.get("user-agent"), h)
    return await _fresh(db, h.application)


@router.put("/handoff/session/birth-certificate")
async def phone_confirm_birth_certificate(
    body: ConfirmBirthIn, h: PhoneDep, db: DbDep
) -> BirthCertificateState:
    await db.refresh(h.application, ["documents", "person", "flags"])
    await _confirm(db, h.application, body)
    return await _fresh(db, h.application)
