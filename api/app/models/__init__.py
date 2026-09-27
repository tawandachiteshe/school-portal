"""ORM models for the tables the API uses. The DDL lives in alembic/ (docs/database/schema.sql)."""

from app.models.academic import (
    AcademicTerm,
    Department,
    Intake,
    Module,
    ModuleOffering,
    OfferingLecturer,
    Programme,
    ProgrammeModule,
    Venue,
)
from app.models.base import Base
from app.models.content import (
    Announcement,
    AnnouncementRead,
    AnnouncementTarget,
    CourseMaterial,
    MaterialDownload,
)
from app.models.identity import NotificationPreference, Person, User, UserRole, WebSession
from app.models.library import LibraryCopy, LibraryItem, LibraryLoan
from app.models.people import Staff, Student
from app.models.teaching import (
    Assessment,
    Enrolment,
    ModuleResult,
    Submission,
    SubmissionFile,
    TimetableException,
    TimetableSlot,
    UploadSession,
)

__all__ = [
    "AcademicTerm",
    "Announcement",
    "AnnouncementRead",
    "AnnouncementTarget",
    "Assessment",
    "Base",
    "CourseMaterial",
    "Department",
    "Enrolment",
    "Intake",
    "LibraryCopy",
    "LibraryItem",
    "LibraryLoan",
    "MaterialDownload",
    "Module",
    "ModuleOffering",
    "ModuleResult",
    "NotificationPreference",
    "OfferingLecturer",
    "Person",
    "Programme",
    "ProgrammeModule",
    "Staff",
    "Student",
    "Submission",
    "SubmissionFile",
    "TimetableException",
    "TimetableSlot",
    "User",
    "UploadSession",
    "UserRole",
    "Venue",
    "WebSession",
]
