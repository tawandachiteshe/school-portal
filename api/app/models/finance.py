import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, uuid_pk

if TYPE_CHECKING:  # relationship targets, imported for type checkers only (no import cycle)
    from app.models.academic import AcademicTerm
    from app.models.people import Student


class FeeTransaction(Base):
    __tablename__ = "fee_transactions"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    term_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("academic_terms.id"))
    kind: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), server_default="USD")
    occurred_on: Mapped[date] = mapped_column(Date)
    receipt_ref: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str | None] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = created_at()

    student: Mapped["Student"] = relationship()
    term: Mapped["AcademicTerm | None"] = relationship()


class FeeDueDate(Base):
    __tablename__ = "fee_due_dates"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    term_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("academic_terms.id"))
    label: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), server_default="USD")
    due_on: Mapped[date] = mapped_column(Date)

    student: Mapped["Student"] = relationship()
    term: Mapped["AcademicTerm | None"] = relationship()


class RemarkRequest(Base):
    __tablename__ = "remark_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("module_offerings.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="received")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(Text)
