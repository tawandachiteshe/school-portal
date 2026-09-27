import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Identity, Integer, SmallInteger, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.academic import ModuleOffering
from app.models.base import USER_ROLE, Base, created_at, uuid_pk


class CourseMaterial(Base):
    __tablename__ = "course_materials"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("module_offerings.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    week: Mapped[int | None] = mapped_column(SmallInteger)
    topic: Mapped[str | None] = mapped_column(Text)
    object_key: Mapped[str | None] = mapped_column(Text)
    external_url: Mapped[str | None] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()

    offering: Mapped[ModuleOffering] = relationship(lazy="joined")


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(Text)
    body_md: Mapped[str] = mapped_column(Text)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    is_pinned: Mapped[bool] = mapped_column(Boolean, server_default="false")
    requires_ack: Mapped[bool] = mapped_column(Boolean, server_default="false")
    publish_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()

    targets: Mapped[list["AnnouncementTarget"]] = relationship(lazy="selectin", cascade="all, delete-orphan")


class AnnouncementTarget(Base):
    __tablename__ = "announcement_targets"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    announcement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("announcements.id", ondelete="CASCADE"))
    role: Mapped[str | None] = mapped_column(USER_ROLE)
    programme_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("programmes.id", ondelete="CASCADE"))
    term_number: Mapped[int | None] = mapped_column(SmallInteger)
    offering_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("module_offerings.id", ondelete="CASCADE")
    )
    intake_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("intakes.id", ondelete="CASCADE"))


class AnnouncementRead(Base):
    __tablename__ = "announcement_reads"

    announcement_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("announcements.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
