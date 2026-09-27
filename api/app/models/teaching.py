import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.academic import ModuleOffering, Venue
from app.models.base import Base, pg_enum, uuid_pk

ASSESSMENT_KIND = pg_enum("assessment_kind", "test", "assignment", "practical", "project", "exam")
SUBMISSION_MODE = pg_enum("submission_mode", "online", "physical", "none")
SUBMISSION_STATUS = pg_enum("submission_status", "draft", "submitted", "late", "marked", "returned")


class Enrolment(Base):
    __tablename__ = "enrolments"

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), primary_key=True
    )
    offering_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("module_offerings.id", ondelete="CASCADE"), primary_key=True
    )
    is_repeat: Mapped[bool] = mapped_column(Boolean, server_default="false")
    dropped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    offering: Mapped[ModuleOffering] = relationship(lazy="joined")


class TimetableSlot(Base):
    __tablename__ = "timetable_slots"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("module_offerings.id", ondelete="CASCADE"))
    day_of_week: Mapped[int] = mapped_column(SmallInteger)  # ISO, 1 = Monday
    starts_at: Mapped[time] = mapped_column(Time)
    ends_at: Mapped[time] = mapped_column(Time)
    venue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venues.id"))
    online_url: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, server_default="lecture")
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)

    offering: Mapped[ModuleOffering] = relationship(lazy="joined")
    venue: Mapped[Venue | None] = relationship(lazy="joined")


class TimetableException(Base):
    __tablename__ = "timetable_exceptions"

    id: Mapped[uuid.UUID] = uuid_pk()
    slot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("timetable_slots.id", ondelete="CASCADE"))
    on_date: Mapped[date] = mapped_column(Date)
    cancelled: Mapped[bool] = mapped_column(Boolean, server_default="false")
    new_starts_at: Mapped[time | None] = mapped_column(Time)
    new_ends_at: Mapped[time | None] = mapped_column(Time)
    new_venue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venues.id"))
    reason: Mapped[str | None] = mapped_column(Text)


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("module_offerings.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(ASSESSMENT_KIND)
    title: Mapped[str] = mapped_column(Text)
    description_md: Mapped[str | None] = mapped_column(Text)
    topics: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    venue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venues.id"))
    weight: Mapped[float] = mapped_column(Numeric(5, 2), server_default="0")
    max_mark: Mapped[float] = mapped_column(Numeric(6, 2), server_default="100")
    submission_mode: Mapped[str] = mapped_column(SUBMISSION_MODE, server_default="online")
    allow_late_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    allow_resubmission: Mapped[bool] = mapped_column(Boolean, server_default="true")
    accepted_extensions: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    marks_due_on: Mapped[date | None] = mapped_column(Date)
    max_file_mb: Mapped[int] = mapped_column(SmallInteger, server_default="20")
    marks_released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    offering: Mapped[ModuleOffering] = relationship(lazy="joined")
    venue: Mapped[Venue | None] = relationship(lazy="joined")


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[uuid.UUID] = uuid_pk()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(SUBMISSION_STATUS, server_default="draft")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mark: Mapped[float | None] = mapped_column(Numeric(6, 2))
    feedback_md: Mapped[str | None] = mapped_column(Text)
    student_note: Mapped[str | None] = mapped_column(Text)
    is_absent: Mapped[bool] = mapped_column(Boolean, server_default="false")
    absence_note: Mapped[str | None] = mapped_column(Text)
    marked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    files: Mapped[list["SubmissionFile"]] = relationship(lazy="selectin")
    assessment: Mapped[Assessment] = relationship()
    student: Mapped["Student"] = relationship()  # noqa: F821


class SubmissionFile(Base):
    __tablename__ = "submission_files"

    id: Mapped[uuid.UUID] = uuid_pk()
    submission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"))
    object_key: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ModuleResult(Base):
    __tablename__ = "module_results"

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), primary_key=True
    )
    offering_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("module_offerings.id", ondelete="CASCADE"), primary_key=True
    )
    coursework_mark: Mapped[float | None] = mapped_column(Numeric(5, 2))
    exam_mark: Mapped[float | None] = mapped_column(Numeric(5, 2))
    final_mark: Mapped[float | None] = mapped_column(Numeric(5, 2))
    grade: Mapped[str | None] = mapped_column(Text)
    is_pass: Mapped[bool | None] = mapped_column(Boolean)
    remarks: Mapped[str | None] = mapped_column(Text)
    entered_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    student: Mapped["Student"] = relationship()  # noqa: F821
    offering: Mapped[ModuleOffering] = relationship()


class UploadSession(Base):
    __tablename__ = "upload_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer)
    received_bytes: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ClassSession(Base):
    __tablename__ = "class_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("module_offerings.id", ondelete="CASCADE"))
    slot_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("timetable_slots.id", ondelete="SET NULL"))
    on_date: Mapped[date] = mapped_column(Date)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    venue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venues.id"))
    register_taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    taken_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    offering: Mapped[ModuleOffering] = relationship(lazy="joined")
    venue: Mapped[Venue | None] = relationship(lazy="joined")


class Attendance(Base):
    __tablename__ = "attendance"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("class_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(Text)
    marked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    marked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
