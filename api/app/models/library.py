import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, uuid_pk


class LibraryItem(Base):
    __tablename__ = "library_items"

    id: Mapped[uuid.UUID] = uuid_pk()
    isbn: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    authors: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    publisher: Mapped[str | None] = mapped_column(Text)
    year: Mapped[int | None] = mapped_column(SmallInteger)
    subjects: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    call_number: Mapped[str | None] = mapped_column(Text)
    edition: Mapped[str | None] = mapped_column(Text)
    e_resource_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()


class LibraryCopy(Base):
    __tablename__ = "library_copies"

    id: Mapped[uuid.UUID] = uuid_pk()
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("library_items.id", ondelete="CASCADE"))
    barcode: Mapped[str] = mapped_column(Text, unique=True)
    location: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="available")

    item: Mapped[LibraryItem] = relationship(lazy="joined")


class LibraryLoan(Base):
    __tablename__ = "library_loans"

    id: Mapped[uuid.UUID] = uuid_pk()
    copy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("library_copies.id"))
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id"))
    borrowed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    renewals: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    fine_amount: Mapped[float] = mapped_column(Numeric(10, 2), server_default="0")
    fine_currency: Mapped[str] = mapped_column(String(3), server_default="USD")
    fine_paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    copy: Mapped[LibraryCopy] = relationship(lazy="joined")
    person: Mapped["Person"] = relationship()  # noqa: F821


class LibraryReservation(Base):
    __tablename__ = "library_reservations"

    id: Mapped[uuid.UUID] = uuid_pk()
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("library_items.id", ondelete="CASCADE"))
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(Text, server_default="waiting")
    copy_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("library_copies.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    collect_by: Mapped[date | None] = mapped_column(Date)

    item: Mapped[LibraryItem] = relationship(lazy="joined")
    person: Mapped["Person"] = relationship()  # noqa: F821
    copy: Mapped[LibraryCopy | None] = relationship()


class ReadingListItem(Base):
    __tablename__ = "reading_list_items"

    offering_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("module_offerings.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("library_items.id", ondelete="CASCADE"), primary_key=True
    )
    note: Mapped[str | None] = mapped_column(Text)
    is_core: Mapped[bool] = mapped_column(Boolean, server_default="true")
    sort_order: Mapped[int] = mapped_column(SmallInteger, server_default="0")

    item: Mapped[LibraryItem] = relationship(lazy="joined")
    offering: Mapped["ModuleOffering"] = relationship()  # noqa: F821
