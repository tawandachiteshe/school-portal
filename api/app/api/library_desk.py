"""Library desk for librarians (design/LibraryDesk, LibraryOverdue): issue, return, renew,
overdue reminders and reservations."""

import csv
import io
import re
import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.library import hours_today
from app.auth.deps import CurrentUser, require_role
from app.config import get_settings
from app.db import get_db
from app.models import (
    LibraryCopy,
    LibraryLoan,
    LibraryReservation,
    Notification,
    NotificationDelivery,
    Person,
    Staff,
    Student,
    User,
)
from app.services import clock

router = APIRouter(prefix="/staff/library", tags=["library desk"])
librarian = require_role("librarian")


def _due_for_new_loan() -> datetime:
    """Closing time on the day the loan period ends (design: "Loan period 2 weeks")."""
    day = clock.today() + timedelta(days=get_settings().library_loan_days)
    closes = (get_settings().library_hours.get(day.isoweekday()) or "20:00-20:00").split("-")[1]
    return clock.at(day, time.fromisoformat(closes))


def _days_late(due: datetime) -> int:
    return max(0, (clock.today() - due.astimezone(clock.tz()).date()).days)


def _notify(db: AsyncSession, person: Person, title: str, body: str | None, key: str, sms: bool) -> bool:
    """In-app notification, plus a queued SMS when the person has a phone. Returns whether SMS was queued."""
    user: User | None = person.user
    if user is None:
        return False
    n = Notification(
        user_id=user.id, category="library", title=title, body=body, link="/library", dedupe_key=key
    )
    db.add(n)
    if sms and user.phone:
        # Sent by the SMS worker once an SMS provider is configured (SMS_PROVIDER).
        db.add(NotificationDelivery(notification=n, channel="sms", status="queued"))
        return True
    return False


# --- today -------------------------------------------------------------------------------------


class DeskToday(BaseModel):
    closes: str | None
    issued_today: int
    returned_today: int
    overdue: int
    reservations_waiting: int
    reservations_ready: int
    loan_days: int
    location: str


@router.get("/today")
async def desk_today(_: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)) -> DeskToday:
    start = clock.at(clock.today(), time(0, 0))
    now = clock.now()
    count = lambda q: db.scalar(select(func.count()).select_from(LibraryLoan).where(q))  # noqa: E731
    res = dict(
        (
            await db.execute(
                select(LibraryReservation.status, func.count())
                .where(LibraryReservation.status.in_(["waiting", "ready"]))
                .group_by(LibraryReservation.status)
            )
        ).all()
    )
    h = hours_today()
    return DeskToday(
        closes=h.closes if h else None,
        issued_today=await count(LibraryLoan.borrowed_at >= start) or 0,
        returned_today=await count(LibraryLoan.returned_at >= start) or 0,
        overdue=await count((LibraryLoan.returned_at.is_(None)) & (LibraryLoan.due_at < now)) or 0,
        reservations_waiting=res.get("waiting", 0),
        reservations_ready=res.get("ready", 0),
        loan_days=get_settings().library_loan_days,
        location=get_settings().library_location,
    )


# --- borrower -----------------------------------------------------------------------------------


class DeskLoan(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None
    barcode: str
    due_at: datetime
    days_late: int
    renewals_left: int


class HeldBook(BaseModel):
    reservation_id: uuid.UUID
    title: str
    barcode: str | None
    collect_by: date | None


class Borrower(BaseModel):
    person_id: uuid.UUID
    name: str
    initials: str
    number: str  # student or staff number
    programme: str | None
    class_group: str | None
    loans: list[DeskLoan]
    held: list[HeldBook]
    overdue: int


def normalise_number(raw: str) -> str:
    """Card barcodes drop the slashes: TCFL20270142 → TCFL/2027/0142."""
    s = raw.strip().upper().replace(" ", "")
    m = re.fullmatch(r"TCFL(\d{4})(\d{4})", s)
    return f"TCFL/{m[1]}/{m[2]}" if m else s


async def _borrower(db: AsyncSession, person: Person, number: str, programme, class_group) -> Borrower:
    loans = (
        (
            await db.execute(
                select(LibraryLoan)
                .where(LibraryLoan.person_id == person.id, LibraryLoan.returned_at.is_(None))
                .order_by(LibraryLoan.due_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    held = (
        (
            await db.execute(
                select(LibraryReservation).where(
                    LibraryReservation.person_id == person.id, LibraryReservation.status == "ready"
                )
            )
        )
        .unique()
        .scalars()
        .all()
    )
    max_r = get_settings().library_max_renewals
    out_loans = [
        DeskLoan(
            id=x.id,
            title=x.copy.item.title,
            author=(x.copy.item.authors[0].split()[-1] if x.copy.item.authors else None),
            barcode=x.copy.barcode,
            due_at=x.due_at,
            days_late=_days_late(x.due_at) if x.due_at < clock.now() else 0,
            renewals_left=max(0, max_r - x.renewals),
        )
        for x in loans
    ]
    copies = {
        c.id: c
        for c in (
            await db.execute(
                select(LibraryCopy).where(LibraryCopy.id.in_([r.copy_id for r in held if r.copy_id]))
            )
        )
        .unique()
        .scalars()
    }
    return Borrower(
        person_id=person.id,
        name=f"{person.first_names.split()[0]} {person.surname}",
        initials=(person.first_names[:1] + person.surname[:1]).upper(),
        number=number,
        programme=programme,
        class_group=class_group,
        loans=out_loans,
        held=[
            HeldBook(
                reservation_id=r.id,
                title=r.item.title,
                barcode=copies[r.copy_id].barcode if r.copy_id in copies else None,
                collect_by=r.collect_by,
            )
            for r in held
        ],
        overdue=sum(1 for x in out_loans if x.days_late > 0),
    )


@router.get("/borrowers/{number:path}")
async def find_borrower(
    number: str, _: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)
) -> Borrower:
    n = normalise_number(number)
    st = (
        await db.execute(select(Student).where(func.upper(Student.student_number) == n))
    ).scalar_one_or_none()
    if st:
        return await _borrower(db, st.person, st.student_number, st.programme.name, st.class_group)
    sf = (await db.execute(select(Staff).where(func.upper(Staff.staff_number) == n))).scalar_one_or_none()
    if sf:
        return await _borrower(db, sf.person, sf.staff_number, sf.position, None)
    raise HTTPException(404, f"No student or staff member with number {n}.")


# --- a copy -------------------------------------------------------------------------------------


class DeskCopy(BaseModel):
    copy_id: uuid.UUID
    barcode: str
    title: str
    authors: list[str]
    edition: str | None
    call_number: str | None
    status: str  # available | on_loan | reference_only | lost | repair
    on_loan_to: str | None
    held_for_person_id: uuid.UUID | None
    held_for: str | None


@router.get("/copies/{barcode}")
async def find_copy(
    barcode: str, _: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)
) -> DeskCopy:
    c = (
        await db.execute(
            select(LibraryCopy).where(func.upper(LibraryCopy.barcode) == barcode.strip().upper())
        )
    ).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, f"No book with barcode {barcode.strip().upper()}.")
    loan = (
        (
            await db.execute(
                select(LibraryLoan).where(LibraryLoan.copy_id == c.id, LibraryLoan.returned_at.is_(None))
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    hold = (
        (
            await db.execute(
                select(LibraryReservation).where(
                    LibraryReservation.copy_id == c.id, LibraryReservation.status == "ready"
                )
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    who = lambda p: f"{p.first_names.split()[0]} {p.surname}" if p else None  # noqa: E731
    return DeskCopy(
        copy_id=c.id,
        barcode=c.barcode,
        title=c.item.title,
        authors=c.item.authors,
        edition=c.item.edition,
        call_number=c.item.call_number,
        status=c.status,
        on_loan_to=who(await db.get(Person, loan.person_id)) if loan else None,
        held_for_person_id=hold.person_id if hold else None,
        held_for=who(await db.get(Person, hold.person_id)) if hold else None,
    )


# --- issue, return, renew -----------------------------------------------------------------------


class IssueIn(BaseModel):
    person_id: uuid.UUID
    barcode: str
    allow_with_overdue: bool = False


class Issued(BaseModel):
    loan_id: uuid.UUID
    title: str
    due_at: datetime
    sms_queued: bool


@router.post("/loans", status_code=201)
async def issue_book(
    body: IssueIn, cu: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)
) -> Issued:
    person = await db.get(Person, body.person_id)
    if person is None:
        raise HTTPException(404, "No such borrower.")
    c = (
        await db.execute(
            select(LibraryCopy).where(func.upper(LibraryCopy.barcode) == body.barcode.strip().upper())
        )
    ).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "No book with that barcode.")
    if c.status == "on_loan":
        raise HTTPException(409, "This copy is already on loan. Return it first.")
    if c.status != "available":
        raise HTTPException(409, "This copy can't be lent (reference only, lost or in repair).")
    hold = (
        (
            await db.execute(
                select(LibraryReservation).where(
                    LibraryReservation.copy_id == c.id, LibraryReservation.status == "ready"
                )
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    if hold and hold.person_id != person.id:
        raise HTTPException(409, "This copy is being kept for someone who reserved it.")
    overdue = await db.scalar(
        select(func.count()).where(
            LibraryLoan.person_id == person.id,
            LibraryLoan.returned_at.is_(None),
            LibraryLoan.due_at < clock.now(),
        )
    )
    if overdue and not body.allow_with_overdue:
        raise HTTPException(409, "This borrower has overdue books. Ask for them back before issuing more.")
    due = _due_for_new_loan()
    loan = LibraryLoan(copy_id=c.id, person_id=person.id, due_at=due, issued_by=cu.user.id)
    db.add(loan)
    c.status = "on_loan"
    # Collecting a reserved book (held for them, or waiting in the queue for this title).
    for r in (
        await db.execute(
            select(LibraryReservation).where(
                LibraryReservation.person_id == person.id,
                LibraryReservation.item_id == c.item_id,
                LibraryReservation.status.in_(["waiting", "ready"]),
            )
        )
    ).scalars():
        r.status = "collected"
    await db.flush()
    await db.refresh(person, ["user"])
    local = due.astimezone(clock.tz())
    sms = _notify(
        db,
        person,
        f"{c.item.title} is due back {local:%a %d %b}",
        f"Return it to the library desk, {get_settings().library_location}, by {local:%H:%M}.",
        f"loan:{loan.id}",
        sms=True,
    )
    await db.commit()
    return Issued(loan_id=loan.id, title=c.item.title, due_at=due, sms_queued=sms)


class ReturnIn(BaseModel):
    barcode: str


class Returned(BaseModel):
    title: str
    borrower: str
    days_late: int
    hold_for: str | None  # "Keep it at the desk for …" when someone reserved it


@router.post("/returns")
async def return_book(
    body: ReturnIn, cu: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)
) -> Returned:
    c = (
        await db.execute(
            select(LibraryCopy).where(func.upper(LibraryCopy.barcode) == body.barcode.strip().upper())
        )
    ).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "No book with that barcode.")
    loan = (
        (
            await db.execute(
                select(LibraryLoan).where(LibraryLoan.copy_id == c.id, LibraryLoan.returned_at.is_(None))
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    if loan is None:
        raise HTTPException(409, "This copy isn't on loan.")
    now = clock.now()
    late = _days_late(loan.due_at) if loan.due_at < now else 0
    loan.returned_at = now
    loan.returned_to = cu.user.id
    c.status = "available"
    borrower = await db.get(Person, loan.person_id)
    # First person waiting for this title gets this copy.
    nxt = (
        (
            await db.execute(
                select(LibraryReservation)
                .where(LibraryReservation.item_id == c.item_id, LibraryReservation.status == "waiting")
                .order_by(LibraryReservation.created_at)
            )
        )
        .scalars()
        .first()
    )
    hold_for = None
    if nxt:
        nxt.status = "ready"
        nxt.copy_id = c.id
        nxt.ready_at = now
        nxt.collect_by = clock.today() + timedelta(days=get_settings().library_hold_days)
        p = await db.get(Person, nxt.person_id)
        await db.refresh(p, ["user"])
        hold_for = f"{p.first_names.split()[0]} {p.surname}"
        _notify(
            db,
            p,
            f"{c.item.title} is ready to collect",
            f"Collect it from the library desk by {nxt.collect_by:%a %d %b}.",
            f"hold:{nxt.id}",
            sms=True,
        )
    await db.commit()
    return Returned(
        title=c.item.title,
        borrower=f"{borrower.first_names.split()[0]} {borrower.surname}" if borrower else "",
        days_late=late,
        hold_for=hold_for,
    )


class RenewedOut(BaseModel):
    due_at: datetime
    renewals_left: int


@router.post("/loans/{loan_id}/renew")
async def desk_renew(
    loan_id: uuid.UUID, _: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)
) -> RenewedOut:
    s = get_settings()
    loan = await db.get(LibraryLoan, loan_id)
    if loan is None or loan.returned_at is not None:
        raise HTTPException(404, "This loan isn't open.")
    if loan.renewals >= s.library_max_renewals:
        raise HTTPException(409, "No renewals left for this loan.")
    waiting = await db.scalar(
        select(func.count()).where(
            LibraryReservation.item_id == loan.copy.item_id, LibraryReservation.status == "waiting"
        )
    )
    if waiting:
        raise HTTPException(409, "Someone has reserved this book, so it can't be renewed.")
    loan.due_at = _due_for_new_loan()
    loan.renewals += 1
    await db.commit()
    return RenewedOut(due_at=loan.due_at, renewals_left=s.library_max_renewals - loan.renewals)


# --- overdue (design/LibraryOverdue) ------------------------------------------------------------


class OverdueLoan(BaseModel):
    loan_id: uuid.UUID
    name: str
    number: str | None
    class_group: str | None
    title: str
    author: str | None
    due_at: datetime
    days_late: int
    last_reminder_at: datetime | None
    last_reminder_channel: str | None
    has_phone: bool


class OverdueList(BaseModel):
    loans: list[OverdueLoan]
    borrowers: int
    longest: int


async def _overdue(db: AsyncSession) -> list[OverdueLoan]:
    rows = (
        (
            await db.execute(
                select(LibraryLoan)
                .where(LibraryLoan.returned_at.is_(None), LibraryLoan.due_at < clock.now())
                .order_by(LibraryLoan.due_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    people = {
        p.id: p
        for p in (await db.execute(select(Person).where(Person.id.in_([r.person_id for r in rows]))))
        .unique()
        .scalars()
    }
    students = {
        s.person_id: s
        for s in (await db.execute(select(Student).where(Student.person_id.in_(people)))).unique().scalars()
    }
    staff = {
        s.person_id: s
        for s in (await db.execute(select(Staff).where(Staff.person_id.in_(people)))).unique().scalars()
    }
    out = []
    for r in rows:
        p = people[r.person_id]
        st, sf = students.get(p.id), staff.get(p.id)
        out.append(
            OverdueLoan(
                loan_id=r.id,
                name=f"{p.first_names.split()[0]} {p.surname}",
                number=st.student_number if st else sf.staff_number if sf else None,
                class_group=st.class_group if st else ("Staff" if sf else None),
                title=r.copy.item.title,
                author=r.copy.item.authors[0].split()[-1] if r.copy.item.authors else None,
                due_at=r.due_at,
                days_late=_days_late(r.due_at),
                last_reminder_at=r.last_reminder_at,
                last_reminder_channel=r.last_reminder_channel,
                has_phone=bool(p.user and p.user.phone),
            )
        )
    return out


@router.get("/overdue")
async def overdue(_: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)) -> OverdueList:
    loans = await _overdue(db)
    return OverdueList(
        loans=loans,
        borrowers=len({(x.number, x.name) for x in loans}),
        longest=max((x.days_late for x in loans), default=0),
    )


@router.get("/overdue.csv")
async def overdue_csv(_: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Student", "Number", "Class", "Book", "Author", "Due", "Days late", "Last reminder"])
    for x in await _overdue(db):
        w.writerow(
            [
                x.name,
                x.number or "",
                x.class_group or "",
                x.title,
                x.author or "",
                x.due_at.astimezone(clock.tz()).date().isoformat(),
                x.days_late,
                x.last_reminder_at.astimezone(clock.tz()).date().isoformat() if x.last_reminder_at else "",
            ]
        )
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="overdue-loans-{clock.today()}.csv"'},
    )


class RemindIn(BaseModel):
    loan_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class Reminded(BaseModel):
    reminded: int
    sms_queued: int
    no_phone: int


@router.post("/overdue/remind")
async def remind(
    body: RemindIn, _: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)
) -> Reminded:
    loans = (
        (
            await db.execute(
                select(LibraryLoan).where(
                    LibraryLoan.id.in_(body.loan_ids),
                    LibraryLoan.returned_at.is_(None),
                    LibraryLoan.due_at < clock.now(),
                )
            )
        )
        .unique()
        .scalars()
        .all()
    )
    now = clock.now()
    sms = no_phone = 0
    for loan in loans:
        p = await db.get(Person, loan.person_id)
        await db.refresh(p, ["user"])
        due = loan.due_at.astimezone(clock.tz())
        # design: "Your library book [title] was due [date]. Please return it to the Block A desk."
        queued = _notify(
            db,
            p,
            f"Your library book {loan.copy.item.title} was due {due:%a %d %b}",
            f"Please return it to the {get_settings().library_location} desk.",
            f"overdue:{loan.id}:{now:%Y%m%d}",
            sms=True,
        )
        sms += queued
        no_phone += not queued
        loan.last_reminder_at = now
        loan.last_reminder_channel = "sms" if queued else "in_app"
    await db.commit()
    return Reminded(reminded=len(loans), sms_queued=sms, no_phone=no_phone)


# --- reservations -------------------------------------------------------------------------------


class DeskReservation(BaseModel):
    id: uuid.UUID
    title: str
    name: str
    number: str | None
    status: str
    created_at: datetime
    collect_by: date | None
    barcode: str | None


@router.get("/reservations")
async def reservations(
    _: CurrentUser = Depends(librarian), db: AsyncSession = Depends(get_db)
) -> list[DeskReservation]:
    rows = (
        (
            await db.execute(
                select(LibraryReservation)
                .where(LibraryReservation.status.in_(["waiting", "ready"]))
                .order_by(LibraryReservation.status.desc(), LibraryReservation.created_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    out = []
    for r in rows:
        p = await db.get(Person, r.person_id)
        st = (await db.execute(select(Student).where(Student.person_id == r.person_id))).scalar_one_or_none()
        copy = await db.get(LibraryCopy, r.copy_id) if r.copy_id else None
        out.append(
            DeskReservation(
                id=r.id,
                title=r.item.title,
                name=f"{p.first_names.split()[0]} {p.surname}" if p else "",
                number=st.student_number if st else None,
                status=r.status,
                created_at=r.created_at,
                collect_by=r.collect_by,
                barcode=copy.barcode if copy else None,
            )
        )
    return out
