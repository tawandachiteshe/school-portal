"""Student library (design/Library): loans, reservations, reading lists, catalogue search, renewals."""

import uuid
from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import DbDep
from app.models import (
    LibraryCopy,
    LibraryItem,
    LibraryLoan,
    LibraryReservation,
    ReadingListItem,
    Student,
)
from app.services import clock
from app.services.students import StudentDep, current_offerings

router = APIRouter(prefix="/library", tags=["library"])

OPEN = ("waiting", "ready")


# --- shared -----------------------------------------------------------------------------------


class Hours(BaseModel):
    opens: str
    closes: str


class LoanOut(BaseModel):
    id: uuid.UUID
    barcode: str
    title: str
    authors: list[str]
    edition: str | None
    due_at: datetime
    renewals_left: int
    renewals_max: int
    overdue: bool


class ReservationOut(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID
    title: str
    authors: list[str]
    status: str  # waiting | ready
    collect_by: date | None
    position: int | None  # place in the queue while waiting


class ReadingListSummary(BaseModel):
    module_code: str
    module_name: str
    books: int
    on_shelf: int


class LibraryHome(BaseModel):
    location: str
    today: Hours | None  # None = closed today
    loans: list[LoanOut]
    reservations: list[ReservationOut]
    reading_lists: list[ReadingListSummary]


class Book(BaseModel):
    id: uuid.UUID
    title: str
    authors: list[str]
    edition: str | None
    year: int | None
    call_number: str | None
    e_resource_url: str | None
    copies: int
    available: int
    on_loan_to_you: bool
    reservation: ReservationOut | None
    note: str | None = None  # reading list note


def hours_today() -> Hours | None:
    spec = get_settings().library_hours.get(clock.today().isoweekday())
    if not spec:
        return None
    opens, closes = spec.split("-")
    return Hours(opens=opens, closes=closes)


async def availability(db: AsyncSession, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int]]:
    """item → (lendable copies, copies on the shelf and not held for someone)."""
    if not item_ids:
        return {}
    held = select(LibraryReservation.copy_id).where(
        LibraryReservation.status == "ready", LibraryReservation.copy_id.is_not(None)
    )
    rows = await db.execute(
        select(
            LibraryCopy.item_id,
            func.count().filter(LibraryCopy.status.in_(["available", "on_loan"])),
            func.count().filter(LibraryCopy.status == "available", LibraryCopy.id.not_in(held)),
        )
        .where(LibraryCopy.item_id.in_(item_ids))
        .group_by(LibraryCopy.item_id)
    )
    return {r[0]: (r[1], r[2]) for r in rows}


async def _my_reservations(db: AsyncSession, person_id: uuid.UUID) -> list[ReservationOut]:
    rows = (
        (
            await db.execute(
                select(LibraryReservation)
                .where(LibraryReservation.person_id == person_id, LibraryReservation.status.in_(OPEN))
                .order_by(LibraryReservation.created_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    out = []
    for r in rows:
        position = None
        if r.status == "waiting":
            position = (
                await db.scalar(
                    select(func.count()).where(
                        LibraryReservation.item_id == r.item_id,
                        LibraryReservation.status == "waiting",
                        LibraryReservation.created_at <= r.created_at,
                    )
                )
                or 1
            )
        out.append(
            ReservationOut(
                id=r.id,
                item_id=r.item_id,
                title=r.item.title,
                authors=r.item.authors,
                status=r.status,
                collect_by=r.collect_by,
                position=position,
            )
        )
    # Ready to collect first.
    out.sort(key=lambda r: r.status != "ready")
    return out


def _loan(loan: LibraryLoan) -> LoanOut:
    return LoanOut(
        id=loan.id,
        barcode=loan.copy.barcode,
        title=loan.copy.item.title,
        authors=loan.copy.item.authors,
        edition=loan.copy.item.edition,
        due_at=loan.due_at,
        renewals_left=max(0, get_settings().library_max_renewals - loan.renewals),
        renewals_max=get_settings().library_max_renewals,
        overdue=loan.due_at < clock.now(),
    )


async def _books(db: AsyncSession, student: Student, items: list[LibraryItem], notes=None) -> list[Book]:
    avail = await availability(db, [i.id for i in items])
    mine = {r.item_id: r for r in await _my_reservations(db, student.person_id)}
    loaned = set(
        (
            await db.execute(
                select(LibraryCopy.item_id)
                .join(LibraryLoan, LibraryLoan.copy_id == LibraryCopy.id)
                .where(LibraryLoan.person_id == student.person_id, LibraryLoan.returned_at.is_(None))
            )
        ).scalars()
    )
    return [
        Book(
            id=i.id,
            title=i.title,
            authors=i.authors,
            edition=i.edition,
            year=i.year,
            call_number=i.call_number,
            e_resource_url=i.e_resource_url,
            copies=avail.get(i.id, (0, 0))[0],
            available=avail.get(i.id, (0, 0))[1],
            on_loan_to_you=i.id in loaned,
            reservation=mine.get(i.id),
            note=(notes or {}).get(i.id),
        )
        for i in items
    ]


# --- endpoints ------------------------------------------------------------------------------


@router.get("/home")
async def library_home(student: StudentDep, db: DbDep) -> LibraryHome:
    loans = (
        (
            await db.execute(
                select(LibraryLoan)
                .where(LibraryLoan.person_id == student.person_id, LibraryLoan.returned_at.is_(None))
                .order_by(LibraryLoan.due_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    lists = []
    for o in sorted(await current_offerings(db, student), key=lambda o: o.module.code):
        items = (
            (await db.execute(select(ReadingListItem).where(ReadingListItem.offering_id == o.id)))
            .unique()
            .scalars()
            .all()
        )
        if not items:
            continue
        avail = await availability(db, [x.item_id for x in items])
        lists.append(
            ReadingListSummary(
                module_code=o.module.code,
                module_name=o.module.name,
                books=len(items),
                on_shelf=sum(1 for x in items if avail.get(x.item_id, (0, 0))[1] > 0),
            )
        )
    return LibraryHome(
        location=get_settings().library_location,
        today=hours_today(),
        loans=[_loan(x) for x in loans],
        reservations=await _my_reservations(db, student.person_id),
        reading_lists=lists,
    )


class ReadingList(BaseModel):
    module_code: str
    module_name: str
    books: list[Book]


@router.get("/reading-lists/{code}")
async def reading_list(code: str, student: StudentDep, db: DbDep) -> ReadingList:
    o = next((o for o in await current_offerings(db, student) if o.module.code == code.upper()), None)
    if o is None:
        raise HTTPException(404, "You're not taking this module this semester.")
    rows = (
        (
            await db.execute(
                select(ReadingListItem)
                .where(ReadingListItem.offering_id == o.id)
                .order_by(ReadingListItem.sort_order, ReadingListItem.is_core.desc())
            )
        )
        .unique()
        .scalars()
        .all()
    )
    books = await _books(db, student, [r.item for r in rows], {r.item_id: r.note for r in rows})
    return ReadingList(module_code=o.module.code, module_name=o.module.name, books=books)


class CatalogueResults(BaseModel):
    query: str
    books: list[Book]


@router.get("/search")
async def search_catalogue(
    student: StudentDep,
    db: DbDep,
    q: Annotated[str, Query(min_length=2, max_length=100)],
) -> CatalogueResults:
    term = q.strip()
    like = f"%{term}%"
    # A module code finds that module's reading list; otherwise title, author or subject.
    listed = select(ReadingListItem.item_id).where(
        ReadingListItem.offering_id.in_(
            [o.id for o in await current_offerings(db, student) if o.module.code == term.upper()]
        )
    )
    rows = (
        (
            await db.execute(
                select(LibraryItem)
                .where(
                    or_(
                        LibraryItem.title.ilike(like),
                        func.array_to_string(LibraryItem.authors, " ").ilike(like),
                        func.array_to_string(LibraryItem.subjects, " ").ilike(like),
                        LibraryItem.isbn == term.replace("-", ""),
                        LibraryItem.id.in_(listed),
                    )
                )
                .order_by(func.similarity(LibraryItem.title, term).desc(), LibraryItem.title)
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    return CatalogueResults(query=term, books=await _books(db, student, list(rows)))


@router.post("/items/{item_id}/reservations", status_code=201)
async def reserve_book(item_id: uuid.UUID, student: StudentDep, db: DbDep) -> ReservationOut:
    item = await db.get(LibraryItem, item_id)
    if item is None:
        raise HTTPException(404, "This book isn't in the catalogue.")
    total, available = (await availability(db, [item_id])).get(item_id, (0, 0))
    if total == 0:
        raise HTTPException(409, "The library has no copies of this book to lend.")
    if available > 0:
        raise HTTPException(409, "A copy is on the shelf. Ask for it at the desk.")
    if any(r.item_id == item_id for r in await _my_reservations(db, student.person_id)):
        raise HTTPException(409, "You've already reserved this book.")
    on_loan = await db.scalar(
        select(func.count())
        .select_from(LibraryLoan)
        .join(LibraryCopy, LibraryCopy.id == LibraryLoan.copy_id)
        .where(
            LibraryCopy.item_id == item_id,
            LibraryLoan.person_id == student.person_id,
            LibraryLoan.returned_at.is_(None),
        )
    )
    if on_loan:
        raise HTTPException(409, "You already have this book on loan.")
    db.add(LibraryReservation(item_id=item_id, person_id=student.person_id))
    await db.commit()
    return next(r for r in await _my_reservations(db, student.person_id) if r.item_id == item_id)


@router.delete("/reservations/{reservation_id}", status_code=204)
async def cancel_reservation(reservation_id: uuid.UUID, student: StudentDep, db: DbDep) -> None:
    r = await db.get(LibraryReservation, reservation_id)
    if r is None or r.person_id != student.person_id or r.status not in OPEN:
        raise HTTPException(404, "This reservation isn't on your account.")
    r.status = "cancelled"
    await db.commit()


class RenewOut(BaseModel):
    id: uuid.UUID
    due_at: datetime
    renewals_left: int


@router.post("/loans/{loan_id}/renew")
async def renew_loan(loan_id: uuid.UUID, student: StudentDep, db: DbDep) -> RenewOut:
    s = get_settings()
    loan = await db.get(LibraryLoan, loan_id)
    if loan is None or loan.person_id != student.person_id or loan.returned_at is not None:
        raise HTTPException(404, "This loan isn't on your account.")
    now = clock.now()
    if loan.due_at < now:
        raise HTTPException(
            409, "Overdue books can't be renewed online. Return it to the desk, or ask there."
        )
    if loan.renewals >= s.library_max_renewals:
        raise HTTPException(409, "You've used all your renewals for this book. Return it to the desk.")
    waiting = await db.scalar(
        select(func.count()).where(
            LibraryReservation.item_id == loan.copy.item_id, LibraryReservation.status == "waiting"
        )
    )
    if waiting:
        raise HTTPException(
            409, "Someone has reserved this book, so it can't be renewed. Return it by the due date."
        )
    # Due at closing time on the new due date.
    due_day = now.date() + timedelta(days=s.library_loan_days)
    loan.due_at = clock.at(due_day, time(20, 0))
    loan.renewals += 1
    await db.commit()
    return RenewOut(id=loan.id, due_at=loan.due_at, renewals_left=s.library_max_renewals - loan.renewals)
