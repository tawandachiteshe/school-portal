import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def pg_enum(name: str, *values: str) -> ENUM:
    """A Postgres enum that already exists in the schema (never created by SQLAlchemy)."""
    return ENUM(*values, name=name, create_type=False)


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())


def created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


ROLES = (
    "applicant",
    "student",
    "lecturer",
    "admissions",
    "registry",
    "librarian",
    "admin",
    "student_affairs",
    "accounts",
)
STAFF_ROLES = frozenset(ROLES) - {"applicant", "student"}
USER_ROLE = pg_enum("user_role", *ROLES)
STUDY_MODE = pg_enum("study_mode", "full_time", "part_time", "block_release", "online")
