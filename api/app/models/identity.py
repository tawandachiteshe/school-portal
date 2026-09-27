import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import USER_ROLE, Base, created_at, pg_enum, uuid_pk


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    idp_subject: Mapped[str] = mapped_column(Text, unique=True)
    idp_user_pk: Mapped[int | None] = mapped_column(Integer)
    username: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(CITEXT)
    email_verified: Mapped[bool] = mapped_column(Boolean, server_default="false")
    phone: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    claims_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()

    roles: Mapped[list["UserRole"]] = relationship(lazy="selectin", cascade="all, delete-orphan")
    person: Mapped["Person | None"] = relationship(back_populates="user", lazy="selectin")


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(USER_ROLE, primary_key=True)
    idp_group: Mapped[str] = mapped_column(Text)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WebSession(Base):
    __tablename__ = "web_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    cookie_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    idp_sid: Mapped[str | None] = mapped_column(Text)
    refresh_token_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    id_token_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = created_at()
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(Text)


class Person(Base):
    __tablename__ = "people"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), unique=True
    )
    surname: Mapped[str] = mapped_column(Text)
    first_names: Mapped[str] = mapped_column(Text)
    preferred_name: Mapped[str | None] = mapped_column(Text)
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(pg_enum("gender", "female", "male", "other", "undisclosed"))
    national_id_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    national_id_hmac: Mapped[bytes | None] = mapped_column(LargeBinary, unique=True)
    national_id_masked: Mapped[str | None] = mapped_column(Text)
    national_id_valid: Mapped[bool | None] = mapped_column(Boolean)
    id_reg_district: Mapped[str | None] = mapped_column(String(2))
    id_origin_district: Mapped[str | None] = mapped_column(String(2))
    address: Mapped[str | None] = mapped_column(Text)
    next_of_kin_name: Mapped[str | None] = mapped_column(Text)
    next_of_kin_phone: Mapped[str | None] = mapped_column(Text)
    photo_object_key: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()

    user: Mapped[User | None] = relationship(back_populates="person", lazy="selectin")

    @property
    def given_name(self) -> str:
        return self.preferred_name or self.first_names.split()[0]

    @property
    def full_name(self) -> str:
        return f"{self.given_name} {self.surname}"

    @property
    def initials(self) -> str:
        return (self.given_name[:1] + self.surname[:1]).upper()


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    category: Mapped[str] = mapped_column(
        pg_enum("notif_category", "deadline", "announcement", "result", "library", "application", "system"),
        primary_key=True,
    )
    channel: Mapped[str] = mapped_column(
        pg_enum("notif_channel", "in_app", "push", "email", "sms"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(
        pg_enum("notif_category", "deadline", "announcement", "result", "library", "application", "system")
    )
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str | None] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"))
    channel: Mapped[str] = mapped_column(pg_enum("notif_channel", "in_app", "push", "email", "sms"))
    status: Mapped[str] = mapped_column(Text)  # queued | sent | failed
    provider_ref: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    notification: Mapped[Notification] = relationship()
