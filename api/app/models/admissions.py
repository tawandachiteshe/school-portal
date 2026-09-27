import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.academic import Intake, Programme
from app.models.base import STUDY_MODE, Base, created_at, pg_enum, uuid_pk
from app.models.identity import Person

APPLICATION_STATUS = pg_enum(
    "application_status", "draft", "submitted", "in_review", "more_info", "accepted", "rejected", "withdrawn"
)
DOCUMENT_KIND = pg_enum(
    "document_kind",
    "national_id",
    "zimsec_o_slip",
    "zimsec_o_cert",
    "zimsec_a_slip",
    "zimsec_a_cert",
    "birth_certificate",
    "other",
)


class DistrictCode(Base):
    __tablename__ = "district_codes"

    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    district: Mapped[str] = mapped_column(Text)
    province: Mapped[str | None] = mapped_column(Text)


class ZimsecSubject(Base):
    __tablename__ = "zimsec_subjects"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    level: Mapped[str] = mapped_column(pg_enum("exam_level", "O", "A"), primary_key=True)
    name: Mapped[str] = mapped_column(Text)


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = uuid_pk()
    reference: Mapped[str | None] = mapped_column(Text, unique=True)
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id"))
    intake_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("intakes.id"))
    programme_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("programmes.id"))
    second_choice_programme_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("programmes.id"))
    study_mode: Mapped[str] = mapped_column(STUDY_MODE, server_default="full_time")
    status: Mapped[str] = mapped_column(APPLICATION_STATUS, server_default="draft")
    eligibility: Mapped[str | None] = mapped_column(
        pg_enum("eligibility_result", "eligible", "not_eligible", "needs_review")
    )
    eligibility_detail: Mapped[dict | None] = mapped_column(JSONB)
    risk_score: Mapped[int] = mapped_column(Integer, server_default="0")
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_reason: Mapped[str | None] = mapped_column(Text)
    consent_processing_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_ai_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    offer_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    offer_declined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    person: Mapped[Person] = relationship(lazy="joined")
    programme: Mapped[Programme] = relationship(lazy="joined", foreign_keys=[programme_id])
    intake: Mapped[Intake] = relationship(lazy="joined")
    documents: Mapped[list["Document"]] = relationship(lazy="selectin", cascade="all, delete-orphan")
    sittings: Mapped[list["ExamSitting"]] = relationship(lazy="selectin", cascade="all, delete-orphan")
    flags: Mapped[list["ApplicationFlag"]] = relationship(lazy="selectin", cascade="all, delete-orphan")


class ApplicationEvent(Base):
    __tablename__ = "application_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(Text, server_default="status")
    from_status: Mapped[str | None] = mapped_column(APPLICATION_STATUS)
    to_status: Mapped[str | None] = mapped_column(APPLICATION_STATUS)
    comment: Mapped[str | None] = mapped_column(Text)
    visible_to_applicant: Mapped[bool] = mapped_column(Boolean, server_default="false")
    via: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    handoff_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("device_handoffs.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(DOCUMENT_KIND)
    status: Mapped[str] = mapped_column(
        pg_enum(
            "document_status",
            "uploaded",
            "processing",
            "extracted",
            "failed",
            "confirmed",
            "approved",
            "rejected",
        ),
        server_default="uploaded",
    )
    object_key: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[bytes] = mapped_column(LargeBinary)
    page_count: Mapped[int] = mapped_column(SmallInteger, server_default="1")
    quality_score: Mapped[float | None] = mapped_column(Numeric(4, 3))
    ocr_engine: Mapped[str | None] = mapped_column(
        pg_enum("ocr_engine", "paddle", "tesseract", "llm", "manual")
    )
    ocr_text: Mapped[str | None] = mapped_column(Text)
    ocr_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    error: Mapped[str | None] = mapped_column(Text)
    extracted: Mapped[dict | None] = mapped_column(JSONB)
    capture_device: Mapped[str | None] = mapped_column(Text)  # 'phone (Android · Chrome)'
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    fields: Mapped[list["DocumentField"]] = relationship(lazy="selectin", cascade="all, delete-orphan")


class DocumentField(Base):
    __tablename__ = "document_fields"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    field: Mapped[str] = mapped_column(Text)  # 'surname', 'subjects[3].grade'
    ocr_value: Mapped[str | None] = mapped_column(Text)
    llm_value: Mapped[str | None] = mapped_column(Text)
    confirmed_value: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    bbox: Mapped[dict | None] = mapped_column(JSONB)
    edited_by_applicant: Mapped[bool] = mapped_column(
        Boolean, Computed("confirmed_value IS DISTINCT FROM COALESCE(llm_value, ocr_value)", persisted=True)
    )


class ExamSitting(Base):
    __tablename__ = "exam_sittings"

    id: Mapped[uuid.UUID] = uuid_pk()
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    level: Mapped[str] = mapped_column(pg_enum("exam_level", "O", "A"))
    session: Mapped[str] = mapped_column(pg_enum("exam_session", "JUNE", "NOVEMBER"))
    year: Mapped[int] = mapped_column(SmallInteger)
    centre_number: Mapped[str] = mapped_column(String(6))
    candidate_number: Mapped[str] = mapped_column(String(4))
    candidate_name: Mapped[str] = mapped_column(Text)
    verification: Mapped[str] = mapped_column(
        pg_enum("zimsec_verification", "unverified", "pending", "verified", "mismatch"),
        server_default="unverified",
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()

    results: Mapped[list["ExamSubjectResult"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", order_by="ExamSubjectResult.id"
    )


class ExamSubjectResult(Base):
    __tablename__ = "exam_subject_results"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    sitting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exam_sittings.id", ondelete="CASCADE"))
    subject_code: Mapped[str | None] = mapped_column(Text)
    subject_name: Mapped[str] = mapped_column(Text)
    grade: Mapped[str] = mapped_column(Text)


class ApplicationFlag(Base):
    __tablename__ = "application_flags"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(Text)  # 'ID_CHECK_FAILED', 'NAME_MISMATCH', …
    severity: Mapped[str] = mapped_column(pg_enum("flag_severity", "low", "medium", "high", "block"))
    detail: Mapped[dict | None] = mapped_column(JSONB)  # {"text": "Name differs: ID and slip"}
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()


class DeviceHandoff(Base):
    """ "Continue on your phone": a single-use link giving a phone a short onboarding-only session."""

    __tablename__ = "device_handoffs"

    id: Mapped[uuid.UUID] = uuid_pk()
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    short_code_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    match_code: Mapped[str] = mapped_column(String(4))
    start_step: Mapped[str] = mapped_column(Text)
    sent_via: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()
    claim_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_user_agent: Mapped[str | None] = mapped_column(Text)
    claimed_ip: Mapped[str | None] = mapped_column(INET)
    session_hash: Mapped[bytes | None] = mapped_column(LargeBinary, unique=True)
    session_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    application: Mapped[Application] = relationship(lazy="joined")
