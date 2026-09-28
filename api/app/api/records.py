"""Student records: timetable (+ calendar feed), results (+ slip, re-marks), fees (+ statement), card."""

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.me import term_info
from app.api.types import AssessmentKind, ClassKind
from app.auth.deps import CurrentUserDep
from app.config import get_settings
from app.db import DbDep
from app.models import (
    AcademicTerm,
    Assessment,
    FeeDueDate,
    FeeTransaction,
    ModuleOffering,
    ModuleResult,
    RemarkRequest,
    Student,
    Submission,
)
from app.pdf import make_pdf
from app.services import clock, timetable
from app.services.announcements import visible
from app.services.students import StudentDep, current_offerings

router = APIRouter(prefix="/student", tags=["records"])


# --- timetable -------------------------------------------------------------------------------


class Slot(BaseModel):
    module_code: str
    module_name: str
    kind: ClassKind
    starts_at: datetime
    ends_at: datetime
    venue: str | None
    lecturer: str | None
    cancelled: bool
    change_reason: str | None
    assessment_title: str | None


class Day(BaseModel):
    date: date
    classes: list[Slot]


class Notice(BaseModel):
    date: date
    text: str
    announcement_id: uuid.UUID


class WeekDue(BaseModel):
    id: uuid.UUID
    kind: AssessmentKind
    title: str
    module_code: str
    due_at: datetime
    submitted: bool


class Week(BaseModel):
    week: int | None
    starts_on: date
    ends_on: date
    term_name: str | None
    class_group: str | None
    days: list[Day]
    notices: list[Notice]
    due: list[WeekDue]  # assignments and tests due this week (desktop week grid)
    has_previous: bool
    has_next: bool


@router.get("/timetable")
async def week_timetable(
    cu: CurrentUserDep,
    student: StudentDep,
    db: DbDep,
    start: date | None = Query(default=None, description="Any date in the week; defaults to this week"),
) -> Week:
    today = clock.today()
    # At the weekend, "this week" is over: open next week unless a week was asked for.
    d = start or (today + timedelta(days=7 - today.weekday()) if today.weekday() >= 5 else today)
    monday = d - timedelta(days=d.weekday())
    days = [monday + timedelta(days=i) for i in range(7)]
    offerings = await current_offerings(db, student)
    occ = await timetable.occurrences(db, [o.id for o in offerings], days)
    term = offerings[0].term if offerings else None

    # Monday–Friday always; weekend days only if something is on.
    shown = [x for x in days if x.weekday() < 5 or any(o.starts_at.date() == x for o in occ)]
    out_days = [
        Day(
            date=x,
            classes=[
                Slot(
                    module_code=o.module_code,
                    module_name=o.module_name,
                    kind=o.kind,
                    starts_at=o.starts_at,
                    ends_at=o.ends_at,
                    venue=o.venue,
                    lecturer=o.lecturer,
                    cancelled=o.cancelled,
                    change_reason=o.change_reason,
                    assessment_title=o.assessment_title,
                )
                for o in occ
                if o.starts_at.date() == x
            ],
        )
        for x in shown
    ]

    notices = []
    for a in await visible(db, cu.user.id):
        if a.affects_on and monday <= a.affects_on <= days[-1] and a.affects_venue_id:
            hit = [o for o in occ if o.starts_at.date() == a.affects_on and o.venue_id == a.affects_venue_id]
            tail = (
                f"Your {', '.join(dict.fromkeys(o.module_code for o in hit))} class is affected."
                if hit
                else "None of your classes are affected."
            )
            notices.append(Notice(date=a.affects_on, text=f"{a.title}. {tail}", announcement_id=a.id))

    week_start = clock.at(monday, time(0, 0))
    week_end = week_start + timedelta(days=7)
    assessments = (
        (
            await db.execute(
                select(Assessment)
                .where(
                    Assessment.offering_id.in_([o.id for o in offerings]),
                    Assessment.published_at.is_not(None),
                    Assessment.due_at >= week_start,
                    Assessment.due_at < week_end,
                )
                .order_by(Assessment.due_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    done = set(
        (
            await db.execute(
                select(Submission.assessment_id).where(
                    Submission.student_id == student.id,
                    Submission.assessment_id.in_([a.id for a in assessments]),
                    Submission.status != "draft",
                )
            )
        ).scalars()
    )

    return Week(
        week=term_info(term, max(monday, term.starts_on)).week if term and monday <= term.ends_on else None,
        starts_on=monday,
        ends_on=days[4],
        term_name=term.name if term else None,
        class_group=student.class_group,
        days=out_days,
        notices=notices,
        due=[
            WeekDue(
                id=a.id,
                kind=a.kind,
                title=a.title,
                module_code=a.offering.module.code,
                due_at=a.due_at,
                submitted=a.id in done,
            )
            for a in assessments
        ],
        has_previous=bool(term and monday > term.starts_on),
        has_next=bool(term and days[-1] < term.ends_on),
    )


def _ics_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@router.get("/timetable.ics")
async def timetable_ics(student: StudentDep, db: DbDep) -> Response:
    """The rest of this term as a calendar file ("Add this timetable to my phone calendar")."""
    offerings = await current_offerings(db, student)
    if not offerings:
        raise HTTPException(404, "No timetable this semester.")
    term = offerings[0].term
    start = max(clock.today(), term.starts_on)
    days = [start + timedelta(days=i) for i in range((term.ends_on - start).days + 1)]
    occ = await timetable.occurrences(db, [o.id for o in offerings], days)
    stamp = datetime.now().strftime("%Y%m%dT%H%M%SZ")
    fmt = "%Y%m%dT%H%M%S"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TCFL Portal//Timetable//EN", "CALSCALE:GREGORIAN"]
    for o in occ:
        if o.cancelled:
            continue
        title = f"{o.module_code} {o.assessment_title or o.module_name}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:{o.slot_id}-{o.starts_at.date().isoformat()}@tcfl-portal",
            f"DTSTAMP:{stamp}",
            f"DTSTART;TZID={get_settings().timezone}:{o.starts_at.strftime(fmt)}",
            f"DTEND;TZID={get_settings().timezone}:{o.ends_at.strftime(fmt)}",
            f"SUMMARY:{_ics_escape(title)}",
            f"LOCATION:{_ics_escape(o.venue or '')}",
            f"DESCRIPTION:{_ics_escape(o.lecturer or '')}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return Response(
        "\r\n".join(lines) + "\r\n",
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="TCFL timetable {term.name}.ics"'},
    )


# --- results ---------------------------------------------------------------------------------


class ResultRow(BaseModel):
    offering_id: uuid.UUID
    module_code: str
    module_name: str
    coursework_mark: float | None
    exam_mark: float | None
    final_mark: float | None
    grade: str | None
    is_pass: bool | None
    remarks: str | None
    remark_status: str | None


class TermResults(BaseModel):
    term_code: str
    term_name: str
    published_at: datetime | None
    modules: list[ResultRow]
    remark_until: date | None
    notice: str


class Results(BaseModel):
    current_term_name: str | None
    current_published: bool
    terms: list[TermResults]  # newest first; only published terms


async def _results(db: AsyncSession, student: Student) -> Results:
    now = clock.now()
    rows = (
        (await db.execute(select(ModuleResult).where(ModuleResult.student_id == student.id))).scalars().all()
    )
    remarks = {
        r.offering_id: r.status
        for r in (
            await db.execute(select(RemarkRequest).where(RemarkRequest.student_id == student.id))
        ).scalars()
    }
    by_term: dict[str, TermResults] = {}
    for r in rows:
        o = await db.get(ModuleOffering, r.offering_id)
        if o is None or o.results_published_at is None or o.results_published_at > now:
            continue  # students only see published results
        t = by_term.setdefault(
            o.term.code,
            TermResults(
                term_code=o.term.code,
                term_name=o.term.name,
                published_at=o.results_published_at,
                modules=[],
                remark_until=None,
                notice=get_settings().results_notice,
            ),
        )
        t.published_at = max(t.published_at or o.results_published_at, o.results_published_at)
        t.modules.append(
            ResultRow(
                offering_id=o.id,
                module_code=o.module.code,
                module_name=o.module.name,
                coursework_mark=float(r.coursework_mark) if r.coursework_mark is not None else None,
                exam_mark=float(r.exam_mark) if r.exam_mark is not None else None,
                final_mark=float(r.final_mark) if r.final_mark is not None else None,
                grade=r.grade,
                is_pass=r.is_pass,
                remarks=r.remarks,
                remark_status=remarks.get(o.id),
            )
        )
    for t in by_term.values():
        t.modules.sort(key=lambda m: m.module_code)
        if t.published_at:
            t.remark_until = t.published_at.astimezone(clock.tz()).date() + timedelta(
                days=get_settings().results_remark_days
            )
    offerings = await current_offerings(db, student)
    current = offerings[0].term if offerings else None
    current_published = bool(current and current.code in by_term)
    terms = sorted(by_term.values(), key=lambda t: t.published_at or now, reverse=True)
    return Results(
        current_term_name=current.name if current else None, current_published=current_published, terms=terms
    )


@router.get("/results")
async def results(student: StudentDep, db: DbDep) -> Results:
    return await _results(db, student)


@router.get("/results/{term_code}/slip.pdf")
async def results_slip(term_code: str, student: StudentDep, db: DbDep) -> Response:
    t = next((t for t in (await _results(db, student)).terms if t.term_code == term_code), None)
    if t is None:
        raise HTTPException(404, "No published results for that semester.")
    p = student.person
    lines = [
        f"{p.full_name} · {student.student_number}",
        f"{student.programme.name} · {student.class_group or ''}",
        f"Published {t.published_at.astimezone(clock.tz()).strftime('%d %B %Y') if t.published_at else ''}",
        "",
    ]
    for m in t.modules:
        cw = f"{m.coursework_mark:g}" if m.coursework_mark is not None else "-"
        ex = f"{m.exam_mark:g}" if m.exam_mark is not None else "-"
        fin = f"{m.final_mark:g}%" if m.final_mark is not None else "-"
        verdict = "Pass" if m.is_pass else ("Fail" if m.is_pass is False else "")
        lines.append(f"{m.module_code}  {m.module_name}   Coursework {cw} · Exam {ex}   {fin}  {verdict}")
    lines += ["", t.notice]
    pdf = make_pdf(f"Results · {t.term_name}", lines)
    name = f"TCFL results {t.term_name} {student.student_number.replace('/', '-')}.pdf"
    return Response(
        pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


class RemarkIn(BaseModel):
    offering_id: uuid.UUID
    reason: str = Field(min_length=10, max_length=2000)


@router.post("/results/remarks", status_code=201)
async def request_remark(body: RemarkIn, student: StudentDep, db: DbDep) -> dict[str, str]:
    res = await _results(db, student)
    term = next((t for t in res.terms for m in t.modules if m.offering_id == body.offering_id), None)
    if term is None:
        raise HTTPException(404, "No published result for that module.")
    if term.remark_until and clock.today() > term.remark_until:
        raise HTTPException(409, f"Re-mark requests closed on {term.remark_until.strftime('%d %B')}.")
    existing = (
        await db.execute(
            select(RemarkRequest).where(
                RemarkRequest.student_id == student.id, RemarkRequest.offering_id == body.offering_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "You've already asked for a re-mark of this module.")
    db.add(RemarkRequest(student_id=student.id, offering_id=body.offering_id, reason=body.reason.strip()))
    await db.commit()
    return {"status": "received"}


# --- fees ------------------------------------------------------------------------------------


class Line(BaseModel):
    kind: str
    description: str
    amount: Decimal
    occurred_on: date
    receipt_ref: str | None


class NextPayment(BaseModel):
    label: str
    amount: Decimal
    due_on: date


class Fees(BaseModel):
    term_name: str | None
    currency: str
    balance: Decimal
    next_payment: NextPayment | None
    payment_reference: str
    payment_options: str | None
    lines: list[Line]


async def _fees(db: AsyncSession, student: Student) -> Fees:
    term = (await db.execute(select(AcademicTerm).where(AcademicTerm.is_current))).scalar_one_or_none()
    tx = (
        (
            await db.execute(
                select(FeeTransaction)
                .where(FeeTransaction.student_id == student.id)
                .order_by(FeeTransaction.occurred_on, FeeTransaction.created_at)
            )
        )
        .scalars()
        .all()
    )
    balance = sum((Decimal(t.amount) for t in tx), Decimal("0"))
    due = (
        (
            await db.execute(
                select(FeeDueDate)
                .where(FeeDueDate.student_id == student.id, FeeDueDate.due_on >= clock.today())
                .order_by(FeeDueDate.due_on)
            )
        )
        .scalars()
        .first()
    )
    return Fees(
        term_name=term.name if term else None,
        currency="USD",
        balance=balance,
        next_payment=NextPayment(label=due.label, amount=min(Decimal(due.amount), balance), due_on=due.due_on)
        if due and balance > 0
        else None,
        payment_reference=student.student_number,
        payment_options=get_settings().fees_payment_options or None,
        lines=[
            Line(
                kind=t.kind,
                description=t.description,
                amount=Decimal(t.amount),
                occurred_on=t.occurred_on,
                receipt_ref=t.receipt_ref,
            )
            for t in tx
        ],
    )


@router.get("/fees")
async def fees(student: StudentDep, db: DbDep) -> Fees:
    return await _fees(db, student)


@router.get("/fees/statement.pdf")
async def fee_statement(student: StudentDep, db: DbDep) -> Response:
    f = await _fees(db, student)
    lines = [
        f"{student.person.full_name} · {student.student_number}",
        f"Printed {clock.today():%d %B %Y}",
        "",
    ]
    for x in f.lines:
        ref = f" · receipt {x.receipt_ref}" if x.receipt_ref else ""
        lines.append(f"{x.occurred_on:%d %b %Y}  {x.description}{ref}   {x.amount:,.2f}")
    lines += ["", f"Balance: US$ {f.balance:,.2f}", "All amounts in US dollars."]
    pdf = make_pdf(f"Fees statement · {f.term_name or ''}", lines)
    name = f"TCFL fees statement {student.student_number.replace('/', '-')}.pdf"
    return Response(
        pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


# --- student card ----------------------------------------------------------------------------


class Card(BaseModel):
    name: str
    student_number: str
    barcode: str  # Code 128 payload, e.g. TCFL20270142
    programme_name: str
    class_group: str | None
    valid_until: date
    has_photo: bool


@router.get("/card")
async def student_card(student: StudentDep, db: DbDep) -> Card:
    offerings = await current_offerings(db, student)
    term = offerings[0].term if offerings else None
    # Valid to the end of the academic year the current term belongs to (design: 31 December 2027).
    year = (
        int(term.code[:4])
        if term and term.code[:4].isdigit()
        else (term.ends_on if term else clock.today()).year
    )
    return Card(
        name=student.person.full_name,
        student_number=student.student_number,
        barcode=student.student_number.replace("/", ""),
        programme_name=student.programme.name,
        class_group=student.class_group,
        valid_until=date(year, 12, 31),
        has_photo=bool(student.person.photo_object_key),
    )
