"""Reference data the portal needs before anyone can apply: departments, programmes and their entry
rules (design/ProgrammeMobile, Landing), ZIMSEC O-Level subjects and National ID district codes.
Loaded in production by `python -m app.setup reference`, and by the development seed.

DISTRICTS and SUBJECTS are the examples from docs/01 §1.3, not the full lists: the college keeps
those. Load fuller lists from CSV (`app.setup reference --districts … --subjects …`). Codes that
aren't listed still work: the OCR keeps unknown subjects for the applicant to check.
"""

from dataclasses import dataclass

ENGLISH_MATHS = {
    "min_passes": 5,
    "min_grade": "C",
    "level": "O",
    "required_subjects": ["English Language", "Mathematics"],
}

DEPARTMENTS = {
    "ICT": "Information and Communication Technology",
    "TEL": "Telecommunications Engineering",
}


@dataclass(frozen=True)
class ProgrammeSpec:
    name: str
    award: str
    level: str  # programme_level enum: certificate | diploma
    department: str  # DEPARTMENTS code
    terms: int  # semesters
    entry_rules: dict


DIPLOMA, CERTIFICATE = "HEXCO National Diploma", "HEXCO National Certificate"
PROGRAMMES = {
    "DIT": ProgrammeSpec("Diploma in Information Technology", DIPLOMA, "diploma", "ICT", 6, ENGLISH_MATHS),
    "DSE": ProgrammeSpec("Diploma in Software Engineering", DIPLOMA, "diploma", "ICT", 6, ENGLISH_MATHS),
    "DTE": ProgrammeSpec(
        "Diploma in Telecommunications Engineering",
        DIPLOMA,
        "diploma",
        "TEL",
        6,
        {**ENGLISH_MATHS, "required_subjects": ["English Language", "Mathematics", "Physical Science"]},
    ),
    "CCN": ProgrammeSpec(
        "Certificate in Computer Networking", CERTIFICATE, "certificate", "ICT", 4, ENGLISH_MATHS
    ),
}

# docs/01 §1.3 examples. The full list is reference data admissions maintain.
DISTRICTS = {
    "02": ("Beitbridge", "Matabeleland South"),
    "08": ("Bulawayo", "Bulawayo"),
    "22": ("Masvingo", "Masvingo"),
    "29": ("Gweru", "Midlands"),
    "58": ("Kwekwe", "Midlands"),
    "63": ("Harare", "Harare"),
    "75": ("Mutare", "Manicaland"),
}

SUBJECTS = {
    "1122": "English Language",
    "4004": "Mathematics",
    "5009": "Physical Science",
    "4021": "Computer Science",
    "2248": "Geography",
    "3159": "Shona",
    "2167": "History",
    "4006": "Combined Science",
    "7116": "Principles of Accounts",
    "5008": "Biology",
}
