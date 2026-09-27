"""Shared enums for response models. Each becomes one named schema, so the generated web client
gets a single union type per enum (AssessmentKind, SubmissionStatus, …)."""

from enum import StrEnum


class Role(StrEnum):
    applicant = "applicant"
    student = "student"
    lecturer = "lecturer"
    admissions = "admissions"
    registry = "registry"
    librarian = "librarian"
    admin = "admin"
    student_affairs = "student_affairs"
    accounts = "accounts"


class AssessmentKind(StrEnum):
    test = "test"
    assignment = "assignment"
    practical = "practical"
    project = "project"
    exam = "exam"


class SubmissionMode(StrEnum):
    online = "online"
    physical = "physical"
    none = "none"


class SubmissionStatus(StrEnum):
    submitted = "submitted"
    late = "late"
    marked = "marked"
    returned = "returned"


class ClassKind(StrEnum):
    lecture = "lecture"
    tutorial = "tutorial"
    lab = "lab"
    consultation = "consultation"
