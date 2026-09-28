"""Catalogue and reading lists for librarians (no designs; docs/05 §5.9 "librarians manage the
catalogue in the portal"). Students see the same books through app/api/library.py."""

import re
import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.library_desk import LibrarianDep
from app.db import DbDep
from app.models import (
    AcademicTerm,
    LibraryCopy,
    LibraryItem,
    LibraryLoan,
    LibraryReservation,
    ModuleOffering,
    ReadingListItem,
)

router = APIRouter(prefix="/staff/library", tags=["library catalogue"])

BARCODE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,39}$")


class CatalogueItem(BaseModel):
    id: uuid.UUID
    title: str
    authors: list[str]
    edition: str | None
    year: int | None
    isbn: str | None
    call_number: str | None
    subjects: list[str]
    copies: int
    available: int
    on_loan: int
    reservations_waiting: int
    barcodes: list[str]


async def _items(db: AsyncSession, items: list[LibraryItem]) -> list[CatalogueItem]:
    ids = [i.id for i in items]
    if not ids:
        return []
    copies = (await db.execute(select(LibraryCopy).where(LibraryCopy.item_id.in_(ids)))).scalars().all()
    loaned = set(
        (
            await db.execute(
                select(LibraryLoan.copy_id).where(
                    LibraryLoan.copy_id.in_([c.id for c in copies]), LibraryLoan.returned_at.is_(None)
                )
            )
        ).scalars()
    )
    waiting = dict(
        (
            await db.execute(
                select(LibraryReservation.item_id, func.count())
                .where(LibraryReservation.item_id.in_(ids), LibraryReservation.status == "waiting")
                .group_by(LibraryReservation.item_id)
            )
        ).all()
    )
    out = []
    for i in items:
        mine = [c for c in copies if c.item_id == i.id]
        on_loan = sum(c.id in loaned for c in mine)
        out.append(
            CatalogueItem(
                id=i.id,
                title=i.title,
                authors=i.authors,
                edition=i.edition,
                year=i.year,
                isbn=i.isbn,
                call_number=i.call_number,
                subjects=i.subjects,
                copies=len(mine),
                available=sum(c.id not in loaned and c.status == "available" for c in mine),
                on_loan=on_loan,
                reservations_waiting=waiting.get(i.id, 0),
                barcodes=sorted(c.barcode for c in mine),
            )
        )
    return out


@router.get("/catalogue")
async def catalogue(
    _: LibrarianDep,
    db: DbDep,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> list[CatalogueItem]:
    """Title, author, subject, ISBN, call number or a copy's barcode; everything (A–Z) without a query."""
    stmt = select(LibraryItem).order_by(LibraryItem.title).limit(100)
    if q and q.strip():
        like = f"%{q.strip()}%"
        by_barcode = select(LibraryCopy.item_id).where(LibraryCopy.barcode.ilike(like))
        stmt = stmt.where(
            or_(
                LibraryItem.title.ilike(like),
                LibraryItem.isbn.ilike(like),
                LibraryItem.call_number.ilike(like),
                func.array_to_string(LibraryItem.authors, " ").ilike(like),
                func.array_to_string(LibraryItem.subjects, " ").ilike(like),
                LibraryItem.id.in_(by_barcode),
            )
        )
    return await _items(db, list((await db.execute(stmt)).scalars()))


class CopyIn(BaseModel):
    barcode: str = Field(min_length=3, max_length=40)
    location: str | None = Field(default=None, max_length=80)


class BookIn(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    authors: list[str] = Field(default_factory=list, max_length=10)
    edition: str | None = Field(default=None, max_length=40)
    year: int | None = Field(default=None, ge=1800, le=2100)
    isbn: str | None = Field(default=None, max_length=20)
    publisher: str | None = Field(default=None, max_length=120)
    call_number: str | None = Field(default=None, max_length=40)
    subjects: list[str] = Field(default_factory=list, max_length=10)
    copies: list[CopyIn] = Field(default_factory=list, max_length=50)


async def _add_copies(db: AsyncSession, item_id: uuid.UUID, copies: list[CopyIn]) -> None:
    codes = [c.barcode.strip().upper() for c in copies]
    bad = [c for c in codes if not BARCODE.match(c)]
    if bad:
        raise HTTPException(
            422, f"{bad[0]} isn't a barcode: use letters, numbers and dashes, like TCFL-B-004520."
        )
    if len(set(codes)) != len(codes):
        raise HTTPException(422, "The same barcode is in the list twice.")
    taken = (
        (await db.execute(select(LibraryCopy.barcode).where(LibraryCopy.barcode.in_(codes))))
        .scalars()
        .first()
    )
    if taken:
        raise HTTPException(409, f"{taken} is already on another copy.")
    for c, code in zip(copies, codes, strict=True):
        db.add(LibraryCopy(item_id=item_id, barcode=code, location=(c.location or "").strip() or None))


@router.post("/catalogue", status_code=201)
async def add_book(body: BookIn, _: LibrarianDep, db: DbDep) -> CatalogueItem:
    item = LibraryItem(
        title=body.title.strip(),
        authors=[a.strip() for a in body.authors if a.strip()],
        edition=body.edition,
        year=body.year,
        isbn=(body.isbn or "").replace("-", "").strip() or None,
        publisher=body.publisher,
        call_number=body.call_number,
        subjects=[s.strip() for s in body.subjects if s.strip()],
    )
    db.add(item)
    await db.flush()
    await _add_copies(db, item.id, body.copies)
    await db.commit()
    return (await _items(db, [item]))[0]


@router.post("/catalogue/{item_id}/copies", status_code=201)
async def add_copy(item_id: uuid.UUID, body: CopyIn, _: LibrarianDep, db: DbDep) -> CatalogueItem:
    item = await db.get(LibraryItem, item_id)
    if item is None:
        raise HTTPException(404, "Book not found")
    await _add_copies(db, item_id, [body])
    await db.commit()
    return (await _items(db, [item]))[0]


# --- reading lists ------------------------------------------------------------------------------


class ListedBook(BaseModel):
    item_id: uuid.UUID
    title: str
    authors: list[str]
    is_core: bool
    note: str | None
    copies: int
    available: int


class ModuleReadingList(BaseModel):
    offering_id: uuid.UUID
    module_code: str
    module_name: str
    class_group: str | None
    books: list[ListedBook]


async def _lists(db: AsyncSession) -> list[ModuleReadingList]:
    offerings = (
        (
            await db.execute(
                select(ModuleOffering)
                .join(AcademicTerm, AcademicTerm.id == ModuleOffering.term_id)
                .where(AcademicTerm.is_current)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    rows = (
        (
            await db.execute(
                select(ReadingListItem)
                .where(ReadingListItem.offering_id.in_([o.id for o in offerings]))
                .order_by(ReadingListItem.sort_order)
            )
        )
        .scalars()
        .all()
    )
    stock = {c.id: c for c in await _items(db, list({r.item.id: r.item for r in rows}.values()))}
    out = [
        ModuleReadingList(
            offering_id=o.id,
            module_code=o.module.code,
            module_name=o.module.name,
            class_group=o.class_group,
            books=[
                ListedBook(
                    item_id=r.item_id,
                    title=r.item.title,
                    authors=r.item.authors,
                    is_core=r.is_core,
                    note=r.note,
                    copies=stock[r.item_id].copies,
                    available=stock[r.item_id].available,
                )
                for r in rows
                if r.offering_id == o.id
            ],
        )
        for o in offerings
    ]
    return sorted(out, key=lambda x: (x.module_code, x.class_group or ""))


@router.get("/reading-lists")
async def reading_lists(_: LibrarianDep, db: DbDep) -> list[ModuleReadingList]:
    return await _lists(db)


class ListedIn(BaseModel):
    item_id: uuid.UUID
    is_core: bool = True
    note: str | None = Field(default=None, max_length=200)


@router.post("/reading-lists/{offering_id}/books")
async def add_to_reading_list(
    offering_id: uuid.UUID,
    body: ListedIn,
    _: LibrarianDep,
    db: DbDep,
) -> list[ModuleReadingList]:
    if await db.get(ModuleOffering, offering_id) is None or await db.get(LibraryItem, body.item_id) is None:
        raise HTTPException(404, "Module or book not found")
    row = await db.get(ReadingListItem, (offering_id, body.item_id))
    if row is None:
        last = await db.scalar(
            select(func.coalesce(func.max(ReadingListItem.sort_order), 0)).where(
                ReadingListItem.offering_id == offering_id
            )
        )
        db.add(
            ReadingListItem(
                offering_id=offering_id,
                item_id=body.item_id,
                is_core=body.is_core,
                note=body.note,
                sort_order=(last or 0) + 1,
            )
        )
    else:
        row.is_core, row.note = body.is_core, body.note
    await db.commit()
    return await _lists(db)


@router.delete("/reading-lists/{offering_id}/books/{item_id}")
async def remove_from_reading_list(
    offering_id: uuid.UUID,
    item_id: uuid.UUID,
    _: LibrarianDep,
    db: DbDep,
) -> list[ModuleReadingList]:
    row = await db.get(ReadingListItem, (offering_id, item_id))
    if row is None:
        raise HTTPException(404, "That book isn't on this reading list")
    await db.delete(row)
    await db.commit()
    return await _lists(db)
