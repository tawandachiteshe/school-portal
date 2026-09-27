"""Entry requirements against ZIMSEC results (docs/03 §3.5).

Rules live on programmes.entry_rules:
  {"level": "O", "min_passes": 5, "min_grade": "C", "required_subjects": ["English Language", "Mathematics"]}

The explanation is shown to staff (design/StaffReview "Entry requirements") and in the queue
("Maths below C", "4 passes, needs 5").
"""

from dataclasses import dataclass

PASSING = "ABCDE"  # best to worst; U, X and the M codes never pass
SHORT = {"Mathematics": "Maths", "English Language": "English"}


def at_least(grade: str, minimum: str) -> bool:
    return grade in PASSING and PASSING.index(grade) <= PASSING.index(minimum)


def best_grades(sittings: list[list[tuple[str, str]]]) -> dict[str, str]:
    """Best grade per subject across sittings (a resit can improve a grade)."""
    best: dict[str, str] = {}
    for results in sittings:
        for subject, grade in results:
            old = best.get(subject)
            if old is None or (
                grade in PASSING and (old not in PASSING or PASSING.index(grade) < PASSING.index(old))
            ):
                best[subject] = grade
    return best


@dataclass(frozen=True)
class Requirement:
    label: str
    needed: str
    applicant: str
    met: bool


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    summary: str  # "Meets", or what's missing
    rows: list[Requirement]


def evaluate(rules: dict, grades: dict[str, str]) -> Eligibility:
    minimum = rules.get("min_grade", "C")
    need = int(rules.get("min_passes", 5))
    level = rules.get("level", "O")
    passes = sum(at_least(g, minimum) for g in grades.values())
    rows = [
        Requirement(f"{level}-Level passes at {minimum} or better", str(need), str(passes), passes >= need)
    ]
    missing: list[str] = []
    if passes < need:
        missing.append(f"{passes} {'pass' if passes == 1 else 'passes'}, needs {need}")
    for subject in rules.get("required_subjects", []):
        g = grades.get(subject)
        ok = g is not None and at_least(g, minimum)
        rows.append(Requirement(subject, minimum, g or "—", ok))
        if g is None:
            missing.append(f"No {SHORT.get(subject, subject)}")
        elif not ok:
            missing.append(f"{SHORT.get(subject, subject)} below {minimum}")
    return Eligibility(eligible=not missing, summary="; ".join(missing) or "Meets", rows=rows)


def _shift(grade: str, steps: int) -> str:
    scale = PASSING + "U"
    if grade not in scale:
        return grade
    return scale[min(len(scale) - 1, max(0, scale.index(grade) + steps))]


def unclear_decides(rules: dict, grades: dict[str, str], unclear: set[str]) -> bool:
    """Whether grades read with low confidence could change the outcome if each was misread by one
    grade either way (design/StaffReview: "The two unclear grades don't change eligibility either way")."""
    if not unclear:
        return False
    best = evaluate(rules, {**grades, **{s: _shift(grades[s], -1) for s in unclear if s in grades}}).eligible
    worst = evaluate(rules, {**grades, **{s: _shift(grades[s], 1) for s in unclear if s in grades}}).eligible
    return best != worst
