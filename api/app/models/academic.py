import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import STUDY_MODE, Base, created_at, pg_enum, uuid_pk

if TYPE_CHECKING:  # relationship targets, imported for type checkers only (no import cycle)
    from app.models.people import Staff

PROGRAMME_LEVEL = pg_enum(
    "programme_level", "certificate", "diploma", "higher_national_diploma", "degree", "short_course"
)


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)


class Programme(Base):
    __tablename__ = "programmes"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(PROGRAMME_LEVEL)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id"))
    duration_terms: Mapped[int] = mapped_column(SmallInteger)
    entry_rules: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    is_accepting_applications: Mapped[bool] = mapped_column(Boolean, server_default="true")
    award: Mapped[str | None] = mapped_column(Text)  # "HEXCO National Diploma"

    department: Mapped[Department | None] = relationship()


class AcademicTerm(Base):
    __tablename__ = "academic_terms"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, server_default="false")


class Intake(Base):
    __tablename__ = "intakes"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    first_term_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("academic_terms.id"))
    opens_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closes_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    first_term: Mapped[AcademicTerm | None] = relationship(lazy="joined")


class Module(Base):
    __tablename__ = "modules"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    credits: Mapped[int] = mapped_column(SmallInteger)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id"))
    coursework_weight: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="40")

    department: Mapped[Department | None] = relationship()


class ProgrammeModule(Base):
    __tablename__ = "programme_modules"

    programme_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("programmes.id"), primary_key=True)
    module_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("modules.id"), primary_key=True)
    term_number: Mapped[int] = mapped_column(SmallInteger)
    is_core: Mapped[bool] = mapped_column(Boolean, server_default="true")

    programme: Mapped[Programme] = relationship()
    module: Mapped[Module] = relationship()


class Venue(Base):
    __tablename__ = "venues"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    building: Mapped[str | None] = mapped_column(Text)
    capacity: Mapped[int | None] = mapped_column(Integer)


class ModuleOffering(Base):
    __tablename__ = "module_offerings"

    id: Mapped[uuid.UUID] = uuid_pk()
    module_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("modules.id"))
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("academic_terms.id"))
    class_group: Mapped[str] = mapped_column(Text)
    study_mode: Mapped[str] = mapped_column(STUDY_MODE, server_default="full_time")
    lms_course_id: Mapped[str | None] = mapped_column(Text)
    results_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()

    module: Mapped[Module] = relationship(lazy="joined")
    term: Mapped[AcademicTerm] = relationship(lazy="joined")
    lecturers: Mapped[list["OfferingLecturer"]] = relationship(lazy="selectin")


class OfferingLecturer(Base):
    __tablename__ = "offering_lecturers"

    offering_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("module_offerings.id", ondelete="CASCADE"), primary_key=True
    )
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id"), primary_key=True)
    role: Mapped[str] = mapped_column(
        pg_enum("lecturer_role", "lead", "assistant", "tutor"), server_default="lead"
    )

    staff: Mapped["Staff"] = relationship(lazy="joined")


class IntakePlace(Base):
    """Places a programme has in an intake, set by Admissions (not known until they set it)."""

    __tablename__ = "intake_places"

    intake_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("intakes.id", ondelete="CASCADE"), primary_key=True
    )
    programme_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("programmes.id", ondelete="CASCADE"), primary_key=True
    )
    places: Mapped[int] = mapped_column(Integer)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
