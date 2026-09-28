"""Step 3 · ZIMSEC results (design/ZimsecCamera, ZimsecPages, Zimsec, ZimsecDesktop).

Pages are photographed (on the computer or a linked phone) into a "scan"; reading a scan fills in
a sitting the applicant then checks and saves. Saved sittings are exam_sittings rows; each grade
keeps how it was read (document_fields) for Admissions.
"""

import hashlib
import uuid
from datetime import datetime
from enum import StrEnum

from asyncer import asyncify
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.api.apply import applicant
from app.api.apply_id import ACCEPTED, _draft, device_of, phone_session
from app.auth.deps import CurrentUser
from app.config import get_settings
from app.db import get_db, get_sessionmaker
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationFlag,
    DeviceHandoff,
    Document,
    DocumentField,
    ExamSitting,
    ExamSubjectResult,
    ZimsecSubject,
)
from app.ocr.zimsec import GRADES_A, GRADES_O, read_slip
from app.services import clock
from app.services.names import name_words

router = APIRouter(tags=["apply results"])
KIND = "zimsec_o_slip"
PAGES_MAX = 4


class PageQuality(StrEnum):
    clear = "clear"
    blurry = "blurry"
    dark = "dark"


class ScanStatus(StrEnum):
    pages = "pages"  # photographed, not read yet
    reading = "reading"
    read = "read"  # read, waiting for the applicant to check and save
    failed = "failed"
    saved = "saved"


class Page(BaseModel):
    document_id: uuid.UUID
    number: int
    quality: PageQuality | None
    received_at: datetime
    capture_device: str | None


class Crop(BaseModel):
    document_id: uuid.UUID
    x: int
    y: int
    w: int
    h: int
    page_w: int
    page_h: int


class SubjectOut(BaseModel):
    code: str | None
    name: str
    grade: str | None
    check: bool  # low confidence, or no grade read: shown outlined
    read_as: str | None
    crop: Crop | None


class SittingOut(BaseModel):
    key: str  # the saved sitting's id, or the scan's id before saving
    status: ScanStatus
    level: str | None
    session: str | None
    year: int | None
    centre_number: str | None
    candidate_number: str | None
    candidate_name: str | None
    subjects: list[SubjectOut]
    pages: list[Page]
    read_at: datetime | None


class ZimsecSubjectOut(BaseModel):
    code: str
    name: str


class ResultsState(BaseModel):
    sittings: list[SittingOut]
    subjects: list[ZimsecSubjectOut]
    name_on_id: str | None


def _scan_of(d: Document) -> str | None:
    return (d.extracted or {}).get("scan")


async def _reference(db: AsyncSession) -> dict[str, str]:
    rows = await db.execute(
        select(ZimsecSubject).where(ZimsecSubject.level == "O").order_by(ZimsecSubject.name)
    )
    return {s.code: s.name for s in rows.scalars()}


def _pages(docs: list[Document]) -> list[Page]:
    docs = sorted(docs, key=lambda d: (d.extracted or {}).get("page", 0))
    return [
        Page(
            document_id=d.id,
            number=i + 1,
            quality=(d.extracted or {}).get("quality"),
            received_at=d.created_at,
            capture_device=d.capture_device,
        )
        for i, d in enumerate(docs)
    ]


def _crop(doc_id: uuid.UUID, bbox: dict | None, size: tuple[int, int]) -> Crop | None:
    if not bbox or not size[0]:
        return None
    return Crop(
        document_id=doc_id, page_w=size[0], page_h=size[1], **{k: int(bbox[k]) for k in ("x", "y", "w", "h")}
    )


async def results_state(db: AsyncSession, a: Application) -> ResultsState:
    docs = [d for d in a.documents if d.kind == KIND]
    by_scan: dict[str, list[Document]] = {}
    for d in docs:
        by_scan.setdefault(_scan_of(d) or str(d.id), []).append(d)
    min_conf = get_settings().ocr_min_confidence
    fields = {}
    if docs:
        rows = await db.execute(
            select(DocumentField).where(DocumentField.document_id.in_([d.id for d in docs]))
        )
        fields = {(f.document_id, f.field): f for f in rows.scalars()}
    out: list[SittingOut] = []
    saved_scans = set()
    for s in sorted(a.sittings, key=lambda s: (s.year, s.session == "NOVEMBER")):
        first = next((d for d in docs if d.id == s.document_id), None)
        scan = _scan_of(first) if first else None
        saved_scans.add(scan)
        pages = by_scan.get(scan, []) if scan else ([first] if first else [])
        read = (first.extracted or {}).get("read", {}) if first else {}
        read_by_name = {x["name"]: x for x in read.get("subjects", [])}
        subjects = []
        for r in s.results:
            x = read_by_name.get(r.subject_name)
            doc_id = uuid.UUID(x["document_id"]) if x else None
            f = fields.get((doc_id, f"subjects.{r.subject_code}.grade")) if doc_id else None
            unclear = bool(f and f.confidence is not None and float(f.confidence) < min_conf)
            subjects.append(
                SubjectOut(
                    code=r.subject_code,
                    name=r.subject_name,
                    grade=r.grade,
                    check=unclear,
                    read_as=x.get("read_as") if x else None,
                    crop=_crop(doc_id, x.get("bbox"), tuple(x.get("size", (0, 0)))) if x and doc_id else None,
                )
            )
        out.append(
            SittingOut(
                key=str(s.id),
                status=ScanStatus.saved,
                level=s.level,
                session=s.session,
                year=s.year,
                centre_number=s.centre_number,
                candidate_number=s.candidate_number,
                candidate_name=s.candidate_name,
                subjects=subjects,
                pages=_pages(pages),
                read_at=first.updated_at if first else None,
            )
        )
    for scan, pages in by_scan.items():
        if scan in saved_scans:
            continue
        head = min(pages, key=lambda d: (d.extracted or {}).get("page", 0))
        ex = head.extracted or {}
        if ex.get("status") in ("discarded", "saved"):
            continue
        status = ScanStatus(ex.get("status", "pages"))
        read = ex.get("read") or {}
        out.append(
            SittingOut(
                key=scan,
                status=status,
                level=read.get("level"),
                session=read.get("session"),
                year=read.get("year"),
                centre_number=read.get("centre_number"),
                candidate_number=read.get("candidate_number"),
                candidate_name=read.get("candidate_name"),
                subjects=[
                    SubjectOut(
                        code=x.get("code"),
                        name=x["name"],
                        grade=x.get("grade"),
                        check=x.get("grade") is None or x.get("confidence", 1) < min_conf,
                        read_as=x.get("read_as"),
                        crop=_crop(uuid.UUID(x["document_id"]), x.get("bbox"), tuple(x.get("size", (0, 0)))),
                    )
                    for x in read.get("subjects", [])
                ],
                pages=_pages(pages),
                read_at=head.updated_at if status in (ScanStatus.read, ScanStatus.failed) else None,
            )
        )
    p = a.person
    return ResultsState(
        sittings=out,
        subjects=[ZimsecSubjectOut(code=c, name=n) for c, n in (await _reference(db)).items()],
        name_on_id=f"{p.first_names} {p.surname}".upper() if p.national_id_enc else None,
    )


async def _read_scan(application_id: uuid.UUID, scan: str) -> None:
    """Background: read every page of a scan and merge them into one sitting."""
    async with get_sessionmaker()() as db:
        a = await db.get(Application, application_id)
        pages = sorted(
            [d for d in a.documents if _scan_of(d) == scan], key=lambda d: d.extracted.get("page", 0)
        )
        if not pages:
            return
        subjects = await _reference(db)
        merged: dict = {"subjects": []}
        seen: dict[str, dict] = {}
        confs = []
        for d in pages:
            try:
                data = await storage.get(get_settings().s3_bucket_documents, d.object_key)
                r = await asyncify(read_slip)(data, d.mime_type, subjects)  # Tesseract blocks
            except Exception:
                continue
            for k in ("level", "session", "year", "centre_number", "candidate_number", "candidate_name"):
                if merged.get(k) is None and getattr(r, k) is not None:
                    merged[k] = getattr(r, k)
            for s in r.subjects:
                x = {
                    "code": s.code,
                    "name": s.name,
                    "grade": s.grade,
                    "confidence": s.confidence,
                    "read_as": s.read_as,
                    "bbox": s.bbox,
                    "size": [r.width, r.height],
                    "document_id": str(d.id),
                }
                if s.name not in seen or s.confidence > seen[s.name]["confidence"]:
                    seen[s.name] = x
            d.ocr_engine = "tesseract"
            d.ocr_text = r.text or None
            d.ocr_confidence = round(r.confidence, 3) if r.subjects else None
            confs.append(r.confidence)
        merged["subjects"] = list(seen.values())
        head = pages[0]
        head.extracted = {
            **head.extracted,
            "status": "read" if merged["subjects"] else "failed",
            "read": merged,
        }
        head.updated_at = clock.now()
        if merged["subjects"]:
            db.add(
                ApplicationEvent(
                    application_id=a.id,
                    kind="document",
                    comment="ZIMSEC slip read",
                    via=(head.capture_device or "").split(" ")[0] or None,
                )
            )
        await db.commit()


def _require_draft(a: Application) -> None:
    if a.status != "draft":
        raise HTTPException(409, "Your application has been submitted, so the results can't change.")


async def _add_page(
    db: AsyncSession,
    a: Application,
    file: UploadFile,
    scan: str | None,
    quality: str | None,
    user_agent: str | None,
    handoff: DeviceHandoff | None,
) -> None:
    _require_draft(a)
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
    scan = scan or uuid.uuid4().hex
    pages = [d for d in a.documents if _scan_of(d) == scan]
    if len(pages) >= PAGES_MAX:
        raise HTTPException(
            422, f"A slip can have up to {PAGES_MAX} pages. Add another sitting for other results."
        )
    key = f"applications/{a.id}/zimsec-{scan[:8]}-{len(pages) + 1}-{uuid.uuid4().hex[:6]}.{ACCEPTED[mime]}"
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
            page_count=1,
            capture_device=f"{kind} ({what})" if what else kind,
            extracted={
                "scan": scan,
                "page": max([(d.extracted or {}).get("page", 0) for d in pages], default=0) + 1,
                "quality": quality if quality in PageQuality.__members__ else None,
                "status": "pages",
            },
        )
    )
    # A new page means the scan must be read again.
    for d in pages:
        d.extracted = {k: v for k, v in (d.extracted or {}).items() if k != "read"} | {"status": "pages"}
    a.updated_at = clock.now()
    await db.commit()


async def _remove_page(db: AsyncSession, a: Application, document_id: uuid.UUID) -> None:
    _require_draft(a)
    d = next((d for d in a.documents if d.id == document_id and d.kind == KIND), None)
    if d is None:
        raise HTTPException(404, "That page isn't on your application.")
    if any(s.document_id == d.id for s in a.sittings):
        raise HTTPException(409, "These results are saved. Add another sitting to change them.")
    scan = _scan_of(d)
    await db.delete(d)
    for other in a.documents:
        if other.id != d.id and _scan_of(other) == scan:
            other.extracted = {k: v for k, v in (other.extracted or {}).items() if k != "read"} | {
                "status": "pages"
            }
    await db.commit()


def _start_read(a: Application, scan: str) -> None:
    _require_draft(a)
    pages = [d for d in a.documents if _scan_of(d) == scan]
    if not pages:
        raise HTTPException(404, "Photograph the slip first.")
    head = min(pages, key=lambda d: d.extracted.get("page", 0))
    head.extracted = {**head.extracted, "status": "reading"}


class SubjectIn(BaseModel):
    code: str | None = Field(default=None, pattern=r"^\d{4}$")
    name: str = Field(min_length=2, max_length=80)
    grade: str = Field(max_length=5)


class SittingIn(BaseModel):
    key: str | None = None
    level: str = Field(pattern=r"^(O|A)$")
    session: str = Field(pattern=r"^(JUNE|NOVEMBER)$")
    year: int = Field(ge=1980, le=2100)
    centre_number: str = Field(pattern=r"^\d{6}$")
    candidate_number: str = Field(pattern=r"^\d{4}$")
    candidate_name: str | None = Field(default=None, max_length=120)
    subjects: list[SubjectIn] = Field(min_length=1, max_length=20)


class SaveResultsIn(BaseModel):
    sittings: list[SittingIn] = Field(min_length=1, max_length=4)


async def _save(db: AsyncSession, a: Application, body: SaveResultsIn, actor: uuid.UUID | None) -> None:
    _require_draft(a)
    if len({(s.level, s.session, s.year) for s in body.sittings}) != len(body.sittings):
        raise HTTPException(422, "Each sitting appears once. Put all the subjects from one sitting together.")
    docs = [d for d in a.documents if d.kind == KIND]
    saved_scan: dict[str, str | None] = {}
    for old in a.sittings:
        head = next((d for d in docs if d.id == old.document_id), None)
        saved_scan[str(old.id)] = _scan_of(head) if head else None
    p = a.person
    unclear_total = 0
    for s in a.sittings:
        await db.delete(s)
    await db.flush()
    for s in body.sittings:
        if s.year > clock.today().year:
            raise HTTPException(422, "Check the year of the exam.")
        grades = GRADES_A if s.level == "A" else GRADES_O
        names = [x.name.strip() for x in s.subjects]
        if len(set(names)) != len(names):
            raise HTTPException(422, "A subject is listed twice. Remove one.")
        for x in s.subjects:
            if x.grade.upper() not in grades:
                raise HTTPException(422, f"Choose a grade for {x.name}.")
        scan = saved_scan.get(s.key or "", s.key)
        pages = sorted([d for d in docs if _scan_of(d) == scan], key=lambda d: d.extracted.get("page", 0))
        head = pages[0] if pages else None
        read = (
            {x["name"]: x for x in ((head.extracted or {}).get("read") or {}).get("subjects", [])}
            if head
            else {}
        )
        sitting = ExamSitting(
            application_id=a.id,
            document_id=head.id if head else None,
            level=s.level,
            session=s.session,
            year=s.year,
            centre_number=s.centre_number,
            candidate_number=s.candidate_number,
            candidate_name=(s.candidate_name or f"{p.first_names} {p.surname}").strip().upper(),
        )
        sitting.results = [
            ExamSubjectResult(subject_code=x.code, subject_name=x.name.strip(), grade=x.grade.upper())
            for x in s.subjects
        ]
        db.add(sitting)
        # How each grade was read, for Admissions (design/StaffReview "How it was read").
        for x in s.subjects:
            r = read.get(x.name.strip())
            if not r or not x.code:
                continue
            doc_id = uuid.UUID(r["document_id"])
            field_name = f"subjects.{x.code}.grade"
            await db.execute(
                delete(DocumentField).where(
                    DocumentField.document_id == doc_id, DocumentField.field == field_name
                )
            )
            db.add(
                DocumentField(
                    document_id=doc_id,
                    field=field_name,
                    ocr_value=r.get("grade") or r.get("read_as"),
                    confirmed_value=x.grade.upper(),
                    confidence=r.get("confidence"),
                    bbox=r.get("bbox"),
                )
            )
            if r.get("grade") is None or (r.get("confidence") or 1) < get_settings().ocr_min_confidence:
                unclear_total += 1
        for d in pages:
            d.status = "confirmed"
            d.extracted = {**d.extracted, "status": "saved"}
        # Signals for Admissions: the name on the slip, and the same candidate on another application.
        if p.national_id_enc and not name_words(sitting.candidate_name) >= name_words(
            f"{p.first_names} {p.surname}"
        ):
            if not any(f.code == "NAME_MISMATCH" and not f.resolved_at for f in a.flags):
                db.add(
                    ApplicationFlag(
                        application_id=a.id,
                        code="NAME_MISMATCH",
                        severity="medium",
                        detail={"text": "Name differs: ID and slip"},
                    )
                )
        other = await db.scalar(
            select(ExamSitting.id).where(
                ExamSitting.application_id != a.id,
                ExamSitting.level == s.level,
                ExamSitting.session == s.session,
                ExamSitting.year == s.year,
                ExamSitting.centre_number == s.centre_number,
                ExamSitting.candidate_number == s.candidate_number,
            )
        )
        if other and not any(f.code == "DUPLICATE_CANDIDATE" and not f.resolved_at for f in a.flags):
            db.add(
                ApplicationFlag(
                    application_id=a.id,
                    code="DUPLICATE_CANDIDATE",
                    severity="high",
                    detail={"text": "Same ZIMSEC candidate on another application"},
                )
            )
    # Scans the applicant left out (removed sittings) stop showing.
    kept = {saved_scan.get(s.key or "", s.key) for s in body.sittings}
    for d in docs:
        if _scan_of(d) not in kept and (d.extracted or {}).get("status") != "saved":
            d.extracted = {**(d.extracted or {}), "status": "discarded"}
    db.add(
        ApplicationEvent(
            application_id=a.id,
            actor_id=actor,
            kind="document",
            comment="ZIMSEC results checked"
            + (
                f"; {unclear_total} unclear {'grade' if unclear_total == 1 else 'grades'} confirmed"
                if unclear_total
                else ""
            ),
        )
    )
    a.updated_at = clock.now()
    await db.commit()


async def _file(a: Application, document_id: uuid.UUID) -> StreamingResponse:
    d = next((d for d in a.documents if d.id == document_id), None)
    bucket = get_settings().s3_bucket_documents
    if d is None or await storage.size(bucket, d.object_key) is None:
        raise HTTPException(404, "This file is missing.")
    return StreamingResponse(
        storage.stream(bucket, d.object_key),
        media_type=d.mime_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


async def _fresh(db: AsyncSession, a: Application) -> ResultsState:
    await db.refresh(a, ["documents", "sittings", "person", "flags"])
    return await results_state(db, a)


# --- the applicant (computer, or a phone signed in) --------------------------------------------


@router.get("/apply/results")
async def application_results(
    cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> ResultsState:
    return await results_state(db, await _draft(db, cu))


@router.post("/apply/results/pages")
async def add_results_page(
    request: Request,
    file: UploadFile = File(...),
    scan: str | None = Form(default=None),
    quality: str | None = Form(default=None),
    cu: CurrentUser = Depends(applicant),
    db: AsyncSession = Depends(get_db),
) -> ResultsState:
    a = await _draft(db, cu)
    await _add_page(db, a, file, scan, quality, request.headers.get("user-agent"), None)
    return await _fresh(db, a)


@router.delete("/apply/results/pages/{document_id}")
async def remove_results_page(
    document_id: uuid.UUID, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> ResultsState:
    a = await _draft(db, cu)
    await _remove_page(db, a, document_id)
    return await _fresh(db, a)


@router.post("/apply/results/scans/{scan}/read")
async def read_results_scan(
    scan: str,
    background: BackgroundTasks,
    cu: CurrentUser = Depends(applicant),
    db: AsyncSession = Depends(get_db),
) -> ResultsState:
    a = await _draft(db, cu)
    _start_read(a, scan)
    await db.commit()
    background.add_task(_read_scan, a.id, scan)
    return await _fresh(db, a)


@router.put("/apply/results")
async def save_results(
    body: SaveResultsIn, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> ResultsState:
    a = await _draft(db, cu)
    await _save(db, a, body, cu.user.id)
    return await _fresh(db, a)


@router.get("/apply/documents/{document_id}/file", response_class=StreamingResponse)
async def my_document_file(
    document_id: uuid.UUID, cu: CurrentUser = Depends(applicant), db: AsyncSession = Depends(get_db)
) -> StreamingResponse:
    return await _file(await _draft(db, cu), document_id)


# --- a linked phone -------------------------------------------------------------------------------


@router.get("/handoff/session/results")
async def phone_results(
    h: DeviceHandoff = Depends(phone_session), db: AsyncSession = Depends(get_db)
) -> ResultsState:
    return await _fresh(db, h.application)


@router.post("/handoff/session/results/pages")
async def phone_add_results_page(
    request: Request,
    file: UploadFile = File(...),
    scan: str | None = Form(default=None),
    quality: str | None = Form(default=None),
    h: DeviceHandoff = Depends(phone_session),
    db: AsyncSession = Depends(get_db),
) -> ResultsState:
    await _add_page(db, h.application, file, scan, quality, request.headers.get("user-agent"), h)
    return await _fresh(db, h.application)


@router.delete("/handoff/session/results/pages/{document_id}")
async def phone_remove_results_page(
    document_id: uuid.UUID, h: DeviceHandoff = Depends(phone_session), db: AsyncSession = Depends(get_db)
) -> ResultsState:
    await _remove_page(db, h.application, document_id)
    return await _fresh(db, h.application)


@router.post("/handoff/session/results/scans/{scan}/read")
async def phone_read_results_scan(
    scan: str,
    background: BackgroundTasks,
    h: DeviceHandoff = Depends(phone_session),
    db: AsyncSession = Depends(get_db),
) -> ResultsState:
    _start_read(h.application, scan)
    await db.commit()
    background.add_task(_read_scan, h.application_id, scan)
    return await _fresh(db, h.application)


@router.put("/handoff/session/results")
async def phone_save_results(
    body: SaveResultsIn, h: DeviceHandoff = Depends(phone_session), db: AsyncSession = Depends(get_db)
) -> ResultsState:
    await _save(db, h.application, body, None)
    return await _fresh(db, h.application)


@router.get("/handoff/session/documents/{document_id}/file", response_class=StreamingResponse)
async def phone_document_file(
    document_id: uuid.UUID, h: DeviceHandoff = Depends(phone_session), db: AsyncSession = Depends(get_db)
) -> StreamingResponse:
    await db.refresh(h.application, ["documents"])
    return await _file(h.application, document_id)
