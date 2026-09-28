"""Step 5 · Review (design/ReviewEligible, ReviewNotEligible, ReviewDesktop): everything the applicant
entered, and whether it meets the programme's entry requirements, explained in their words."""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

from app import crypto
from app.api.apply import ApplicantDep, ApplyStep, _out, _years
from app.api.apply_birth import birth_state
from app.api.apply_id import _draft, id_state
from app.config import get_settings
from app.db import DbDep
from app.models import Application
from app.services import eligibility

router = APIRouter(tags=["apply review"])
SESSION = {"JUNE": "June", "NOVEMBER": "November"}


class ReviewProgramme(BaseModel):
    name: str
    award: str | None
    length: str
    intake: str


class ReviewId(BaseModel):
    id_number: str
    name: str
    date_of_birth: date | None
    registered_in: str | None
    origin: str | None


class ReviewBirth(BaseModel):
    name: str | None
    date_of_birth: date | None
    matches_id: bool | None


class ReviewSubject(BaseModel):
    code: str | None
    name: str
    grade: str


class ReviewSitting(BaseModel):
    label: str  # "O-Level, November 2022"
    centre_number: str
    candidate_number: str
    subjects: list[ReviewSubject]


class Shortfall(BaseModel):
    """One unmet requirement, in plain words (design/ReviewNotEligible)."""

    need: str  # "It needs Mathematics at grade C or better."
    have: str  # "Your results show Mathematics D (O-Level, November 2022)."
    subject: str | None


class ApplicantEligibility(BaseModel):
    eligible: bool
    summary: str  # "6 passes at C or better, including English Language and Mathematics."
    shortfalls: list[Shortfall]
    other_passes: list[str]  # "English Language B", for "Your other 5 passes are fine"


class ApplicantReview(BaseModel):
    programme: ReviewProgramme
    national_id: ReviewId | None
    birth_certificate: ReviewBirth | None
    sittings: list[ReviewSitting]
    phone_masked: str | None
    eligibility: ApplicantEligibility | None  # None until there are results
    missing: list[ApplyStep]  # steps not finished yet
    admissions_contact: str | None


def _label(level: str, session: str, year: int) -> str:
    return f"{level}-Level, {SESSION.get(session, session.title())} {year}"


def explain(a: Application) -> ApplicantEligibility | None:
    sittings = [s for s in a.sittings if s.level == "O"]
    if not sittings:
        return None
    rules = a.programme.entry_rules or {}
    minimum = rules.get("min_grade", "C")
    need_n = int(rules.get("min_passes", 5))
    level = rules.get("level", "O")
    grades = eligibility.best_grades([[(r.subject_name, r.grade) for r in s.results] for s in sittings])
    where = {}
    for s in sorted(sittings, key=lambda s: (s.year, s.session == "NOVEMBER")):
        for r in s.results:
            if grades.get(r.subject_name) == r.grade:
                where.setdefault(r.subject_name, _label(s.level, s.session, s.year))
    result = eligibility.evaluate(rules, grades)
    required = rules.get("required_subjects", [])
    passes = [n for n, g in grades.items() if eligibility.at_least(g, minimum)]
    shortfalls: list[Shortfall] = []
    for subject in required:
        g = grades.get(subject)
        if g is None:
            shortfalls.append(
                Shortfall(
                    need=f"It needs {subject} at grade {minimum} or better.",
                    have=f"{subject} isn't in your results.",
                    subject=subject,
                )
            )
        elif not eligibility.at_least(g, minimum):
            shortfalls.append(
                Shortfall(
                    need=f"It needs {subject} at grade {minimum} or better.",
                    have=f"Your results show {subject} {g} ({where.get(subject, '')}).".replace(" ()", ""),
                    subject=subject,
                )
            )
    if len(passes) < need_n:
        shortfalls.append(
            Shortfall(
                need=f"It needs {need_n} {level}-Levels at {minimum} or better.",
                have=f"Your results have {len(passes)}.",
                subject=None,
            )
        )
    including = " and ".join([", ".join(required[:-1]), required[-1]] if len(required) > 1 else required)
    summary = f"{len(passes)} passes at {minimum} or better" + (
        f", including {including}." if including else "."
    )
    failing = {s.subject for s in shortfalls}
    return ApplicantEligibility(
        eligible=result.eligible,
        summary=summary,
        shortfalls=shortfalls,
        other_passes=[f"{n} {grades[n]}" for n in passes if n not in failing],
    )


@router.get("/apply/review")
async def application_review(cu: ApplicantDep, db: DbDep) -> ApplicantReview:
    a = await _draft(db, cu)
    out = await _out(db, a)
    idn = await id_state(db, a)
    birth = await birth_state(db, a)
    p = a.person
    missing = [
        ApplyStep(k)
        for k, done in (
            ("national_id", out.steps.national_id),
            ("birth_certificate", out.steps.birth_certificate),
            ("results", out.steps.results),
        )
        if not done
    ]
    return ApplicantReview(
        programme=ReviewProgramme(
            name=a.programme.name,
            award=a.programme.award,
            length=_years(a.programme.duration_terms),
            intake=a.intake.name,
        ),
        national_id=ReviewId(
            id_number=crypto.decrypt(p.national_id_enc),
            name=f"{p.first_names} {p.surname}",
            date_of_birth=p.date_of_birth,
            registered_in=idn.registered_in,
            origin=idn.origin,
        )
        if p.national_id_enc
        else None,
        birth_certificate=ReviewBirth(
            name=birth.name, date_of_birth=birth.date_of_birth, matches_id=birth.matches_id
        )
        if birth.status == "confirmed"
        else None,
        sittings=[
            ReviewSitting(
                label=_label(s.level, s.session, s.year),
                centre_number=s.centre_number,
                candidate_number=s.candidate_number,
                subjects=[
                    ReviewSubject(code=r.subject_code, name=r.subject_name, grade=r.grade) for r in s.results
                ],
            )
            for s in sorted(a.sittings, key=lambda s: (s.year, s.session == "NOVEMBER"))
        ],
        phone_masked=out.phone_masked,
        eligibility=explain(a),
        missing=missing,
        admissions_contact=get_settings().admissions_contact or None,
    )
