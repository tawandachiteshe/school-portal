import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, SmallInteger, Text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.academic import Department, Intake, Programme
from app.models.base import STUDY_MODE, Base, created_at, pg_enum, uuid_pk
from app.models.identity import Person

STUDENT_STATUS = pg_enum("student_status", "active", "suspended", "deferred", "withdrawn", "graduated")


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id"), unique=True)
    staff_number: Mapped[str] = mapped_column(Text, unique=True)
    title: Mapped[str | None] = mapped_column(Text)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id"))
    position: Mapped[str | None] = mapped_column(Text)
    office: Mapped[str | None] = mapped_column(Text)
    work_email: Mapped[str | None] = mapped_column(CITEXT)
    work_phone: Mapped[str | None] = mapped_column(Text)
    show_phone_to_students: Mapped[bool] = mapped_column(Boolean, server_default="false")
    consultation_hours: Mapped[str | None] = mapped_column(Text)
    bio: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")

    person: Mapped[Person] = relationship(lazy="joined")
    department: Mapped[Department | None] = relationship(lazy="joined")

    @property
    def short_name(self) -> str:
        """'Eng. F. Chikore' — how students and the designs refer to lecturers."""
        initial = self.person.first_names[:1]
        return " ".join(p for p in (self.title, f"{initial}.", self.person.surname) if p)


class Student(Base):
    __tablename__ = "students"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id"), unique=True)
    student_number: Mapped[str] = mapped_column(Text, unique=True)
    programme_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("programmes.id"))
    intake_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("intakes.id"))
    application_id: Mapped[uuid.UUID | None] = mapped_column()
    study_mode: Mapped[str] = mapped_column(STUDY_MODE, server_default="full_time")
    current_term_number: Mapped[int] = mapped_column(SmallInteger, server_default="1")
    class_group: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(STUDENT_STATUS, server_default="active")
    fees_cleared: Mapped[bool] = mapped_column(Boolean, server_default="false")
    fees_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()

    person: Mapped[Person] = relationship(lazy="joined")
    programme: Mapped[Programme] = relationship(lazy="joined")
    intake: Mapped[Intake | None] = relationship(lazy="joined")

    @property
    def year_of_study(self) -> int:
        return (self.current_term_number + 1) // 2
