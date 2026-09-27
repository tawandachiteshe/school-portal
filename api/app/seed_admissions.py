"""Admissions sample data (design/StaffQueue, StaffReview): the 2027 intake queue.

The design's national IDs don't pass the mod-23 check (63-2047823 Q 29 should end in C), so the
seed keeps each number and uses the check letter the algorithm expects. Identity photos and results
slips are drawn as SVG and marked SAMPLE.
"""

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from xml.sax.saxutils import escape

from sqlalchemy.ext.asyncio import AsyncSession

from app import crypto, storage
from app.config import get_settings
from app.models import (
    Application,
    ApplicationEvent,
    ApplicationFlag,
    ApplicationPayment,
    DistrictCode,
    Document,
    DocumentField,
    ExamSitting,
    ExamSubjectResult,
    Intake,
    Person,
    Programme,
    User,
    UserRole,
    ZimsecSubject,
)
from app.ocr.national_id import expected_letter
from app.services import clock

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
CODE = {v: k for k, v in SUBJECTS.items()}


@dataclass
class Applicant:
    ref: str
    first: str
    surname: str
    id_raw: str  # "63-2047823 29": registration-serial and origin; the check letter is computed
    programme: str
    days_ago: int
    at: str
    grades: dict[str, str]
    owner: bool = False
    status: str = "submitted"
    flags: list[tuple[str, str, str]] = field(default_factory=list)  # (code, severity, text)
    unclear: dict[str, str] = field(default_factory=dict)  # subject → first read, confirmed by applicant
    resit: dict[str, str] | None = None  # June resit grades
    slip_name: str | None = None
    bad_letter: bool = False
    phone: str | None = None
    dob: date = date(2006, 1, 1)
    decision: str | None = None


MEETS = {
    "English Language": "B",
    "Mathematics": "C",
    "Computer Science": "B",
    "Geography": "C",
    "History": "B",
}
SCIENCE = {**MEETS, "Physical Science": "C"}

APPLICANTS = [
    Applicant(
        "APP-27-08772",
        "Rudo",
        "Mhlanga",
        "42-0936115 42",
        "CCN",
        3,
        "20:17",
        {**MEETS, "Mathematics": "D", "Shona": "B"},
        dob=date(2007, 2, 9),
    ),
    Applicant(
        "APP-27-08790",
        "Tinashe",
        "Chirwa",
        "08-1187432 08",
        "DTE",
        2,
        "09:41",
        SCIENCE,
        owner=True,
        flags=[("GRADE_UNCLEAR", "medium", "1 grade unclear")],
        dob=date(2006, 8, 21),
    ),
    Applicant(
        "APP-27-08821", "Kudakwashe", "Dube", "63-1872290 07", "DSE", 2, "16:30", MEETS, dob=date(2006, 11, 3)
    ),
    Applicant(
        "APP-27-08834",
        "Nyasha",
        "Sibanda",
        "22-0458813 22",
        "DIT",
        1,
        "08:12",
        MEETS,
        flags=[("NAME_MISMATCH", "medium", "Name differs: ID and slip")],
        slip_name="NYASHA SIBANDE",
        dob=date(2006, 6, 30),
    ),
    Applicant(
        "APP-27-08840",
        "Farai",
        "Mupfumira",
        "58-2230947 58",
        "DTE",
        1,
        "10:55",
        SCIENCE,
        dob=date(2005, 12, 12),
    ),
    Applicant(
        "APP-27-08852",
        "Tatenda",
        "Nyathi",
        "08-0987123 08",
        "DIT",
        1,
        "13:02",
        {**MEETS, "Mathematics": "D"},
        resit={"Mathematics": "C"},
        dob=date(2005, 9, 18),
    ),
    Applicant(
        "APP-27-08861", "Ruvimbo", "Makoni", "63-2311786 63", "DSE", 1, "19:48", MEETS, dob=date(2006, 3, 25)
    ),
    Applicant(
        "APP-27-08877",
        "Tanaka",
        "Zhou",
        "63-1990342 70",
        "CCN",
        0,
        "07:20",
        {
            "English Language": "C",
            "Mathematics": "C",
            "Computer Science": "B",
            "Geography": "C",
            "History": "D",
            "Shona": "E",
        },
        dob=date(2007, 1, 14),
    ),
    Applicant(
        "APP-27-08880",
        "Nokuthula",
        "Ncube",
        "08-2204567 21",
        "DIT",
        0,
        "09:05",
        MEETS,
        flags=[("ID_PHOTO_QUALITY", "medium", "ID photo blurred")],
        dob=date(2006, 7, 7),
    ),
    # Needs checking: signals that stop a decision until someone looks.
    Applicant(
        "APP-27-08885",
        "Rufaro",
        "Gumede",
        "75-1408826 75",
        "DIT",
        0,
        "10:02",
        MEETS,
        flags=[("ID_CHECK_FAILED", "high", "ID check letter doesn't match")],
        bad_letter=True,
        dob=date(2006, 10, 1),
    ),
    Applicant(
        "APP-27-08829",
        "Kudzai",
        "Marimo",
        "63-2215093 63",
        "DSE",
        1,
        "11:40",
        MEETS,
        flags=[("DUPLICATE_CANDIDATE", "high", "Same ZIMSEC candidate on another application")],
        dob=date(2006, 5, 5),
    ),
    # Waiting for the applicant, and decided.
    Applicant(
        "APP-27-08801",
        "Tafadzwa",
        "Banda",
        "63-1760452 63",
        "DIT",
        2,
        "12:15",
        MEETS,
        status="more_info",
        decision="Please upload a clearer photo of page 2 of your results slip. The grades are cut off.",
        dob=date(2006, 2, 2),
    ),
    Applicant(
        "APP-27-08741",
        "Munashe",
        "Chari",
        "29-0617354 29",
        "DIT",
        6,
        "15:20",
        MEETS,
        status="accepted",
        dob=date(2006, 4, 4),
    ),
    Applicant(
        "APP-27-08756",
        "Simba",
        "Tshuma",
        "08-1553102 08",
        "DTE",
        5,
        "09:10",
        MEETS,
        status="rejected",
        decision="The Diploma in Telecommunications Engineering needs Physical Science at C or better.",
        dob=date(2006, 9, 9),
    ),
]


def _normalise(reg: str, serial: str, letter: str, origin: str) -> str:
    return f"{reg}-{serial} {letter} {origin}"


def _id(raw: str, bad: bool) -> tuple[str, str, str, bool]:
    left, origin = raw.split(" ")
    reg, serial = left.split("-")
    good = expected_letter(reg, serial)
    letter = "ZABCDEFGHJKLMNPQRSTVWXY"[("ZABCDEFGHJKLMNPQRSTVWXY".index(good) + 5) % 23] if bad else good
    return _normalise(reg, serial, letter, origin), reg, origin, not bad


def _t(
    x: int, y: int, size: int, text: str, mono: bool = False, fill: str = "#1F1D1A", bold: bool = False
) -> str:
    family = "monospace" if mono else "sans-serif"
    weight = ' font-weight="bold"' if bold else ""
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" fill="{fill}"{weight}>'
        f"{escape(text)}</text>"
    )


def _svg(width: int, height: int, background: str, parts: list[str]) -> bytes:
    body = "".join(parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
        f'<rect width="{width}" height="{height}" rx="16" fill="{background}"/>'
        f"{body}</svg>"
    ).encode()


def _id_svg(name: str, number: str, dob: date) -> bytes:
    return _svg(
        640,
        404,
        "#CFC8B9",
        [
            '<rect x="32" y="40" width="150" height="190" rx="6" fill="#8F887B"/>',
            _t(210, 64, 18, "REPUBLIC OF ZIMBABWE · NATIONAL REGISTRATION", fill="#3E3A33"),
            _t(210, 112, 26, number, mono=True),
            _t(210, 156, 22, name.upper()),
            _t(210, 196, 18, f"DATE OF BIRTH {dob:%d/%m/%Y}", fill="#3E3A33"),
            '<rect x="32" y="300" width="576" height="16" rx="3" fill="#5E594F"/>',
            _t(32, 372, 20, "SAMPLE · development seed, not a real document", fill="#9A2B1F"),
        ],
    )


def _birth_svg(name: str, dob: date) -> bytes:
    return _svg(
        700,
        990,
        "#F1EEE4",
        [
            _t(48, 80, 22, "REPUBLIC OF ZIMBABWE"),
            _t(48, 120, 26, "BIRTH CERTIFICATE", bold=True),
            _t(48, 220, 18, "NAME OF CHILD", fill="#3E3A33"),
            _t(48, 250, 22, name.upper()),
            _t(48, 320, 18, "DATE OF BIRTH", fill="#3E3A33"),
            _t(48, 350, 22, f"{dob.day} {dob:%B %Y}".upper()),
            _t(48, 900, 18, "SAMPLE · development seed, not a real document", fill="#9A2B1F"),
        ],
    )


def _slip_svg(name: str, sitting: ExamSitting, grades: list[tuple[str, str]]) -> bytes:
    head = f"{sitting.level}-LEVEL {sitting.session} {sitting.year}"
    rows = []
    for i, (subject, grade) in enumerate(grades):
        y = 220 + i * 40
        rows += [_t(48, y, 20, CODE.get(subject, "0000"), mono=True), _t(160, y, 20, subject.upper())]
        rows.append(_t(560, y, 22, grade, mono=True, bold=True))
    return _svg(
        700,
        280 + len(grades) * 40,
        "#F4F1EA",
        [
            _t(48, 60, 22, "ZIMBABWE SCHOOL EXAMINATIONS COUNCIL"),
            _t(
                48, 100, 18, f"{head} · CENTRE {sitting.centre_number} · CANDIDATE {sitting.candidate_number}"
            ),
            _t(48, 140, 20, name.upper()),
            *rows,
            _t(48, 250 + len(grades) * 40, 18, "SAMPLE · development seed", fill="#9A2B1F"),
        ],
    )


class AdmissionsSeed:
    def __init__(self, db: AsyncSession, intake: Intake, programmes: dict[str, Programme], officer: Person):
        self.db = db
        self.intake = intake
        self.programmes = programmes
        self.officer = officer.user
        now = clock.now()
        # "Today" in the design is late morning; keep every seeded time in the past.
        self.day0 = (
            clock.today() if now.astimezone(clock.tz()).hour >= 11 else clock.today() - timedelta(days=1)
        )
        try:
            storage.ensure_buckets()
            self.upload = True
        except Exception:
            self.upload = False

    def at(self, days_ago: int, hm: str) -> datetime:
        return clock.at(self.day0 - timedelta(days=days_ago), time.fromisoformat(hm))

    def put(self, key: str, data: bytes) -> None:
        if self.upload:
            storage.put(get_settings().s3_bucket_documents, key, data, "image/svg+xml")

    def reference_data(self) -> None:
        self.db.add_all(DistrictCode(code=c, district=d, province=p) for c, (d, p) in DISTRICTS.items())
        self.db.add_all(ZimsecSubject(code=c, level="O", name=n) for c, n in SUBJECTS.items())

    def document(
        self, app: Application, kind: str, key: str, data: bytes, at: datetime, device: str
    ) -> Document:
        self.put(key, data)
        d = Document(
            application_id=app.id,
            kind=kind,
            status="confirmed",
            object_key=key,
            mime_type="image/svg+xml",
            size_bytes=len(data),
            sha256=hashlib.sha256(data).digest(),
            quality_score=0.93,
            ocr_confidence=0.95,
            capture_device=device,
            created_at=at,
        )
        self.db.add(d)
        return d

    def person_for(self, a: Applicant, number: str, reg: str, origin: str, valid: bool) -> Person:
        u = User(idp_subject=f"seed:applicant:{a.ref}", display_name=f"{a.first} {a.surname}", phone=a.phone)
        u.roles = [UserRole(role="applicant", idp_group="portal-applicants")]
        p = Person(surname=a.surname, first_names=a.first, user=u, date_of_birth=a.dob)
        self.identity(p, number, reg, origin, valid)
        self.db.add_all([u, p])
        return p

    @staticmethod
    def identity(p: Person, number: str, reg: str, origin: str, valid: bool) -> None:
        p.national_id_enc = crypto.encrypt(number)
        p.national_id_hmac = crypto.keyed_hash(number.replace(" ", "").replace("-", ""))
        p.national_id_masked = f"{number[:5]}•••••{number[-4:]}"
        p.national_id_valid = valid
        p.id_reg_district, p.id_origin_district = reg, origin

    async def application(
        self,
        a: Applicant,
        person: Person,
        started: datetime,
        id_read: datetime,
        slip_read: datetime,
        sitting_meta=("NOVEMBER", 2022, "123456"),
        candidate: str = "0457",
        events: bool = True,
    ) -> Application:
        submitted = self.at(a.days_ago, a.at)
        app = Application(
            reference=a.ref,
            person=person,
            intake_id=self.intake.id,
            programme_id=self.programmes[a.programme].id,
            status=a.status,
            submitted_at=submitted,
            created_at=started,
            consent_processing_at=started,
            assigned_to=self.officer.id if a.owner else None,
        )
        self.db.add(app)
        await self.db.flush()
        name = f"{a.first} {a.surname}"
        number = crypto.decrypt(person.national_id_enc)
        id_doc = self.document(
            app,
            "national_id",
            f"seed/applications/{a.ref}/national-id.svg",
            _id_svg(name, number, a.dob),
            id_read,
            "phone (Android · Chrome)",
        )
        await self.db.flush()
        self.db.add_all(
            [
                DocumentField(
                    document_id=id_doc.id,
                    field="national_id",
                    llm_value=number,
                    confirmed_value=number,
                    confidence=0.97,
                ),
                DocumentField(
                    document_id=id_doc.id,
                    field="first_names",
                    llm_value=a.first.upper(),
                    confirmed_value=a.first.upper(),
                    confidence=0.96,
                ),
                DocumentField(
                    document_id=id_doc.id,
                    field="surname",
                    llm_value=a.surname.upper(),
                    confirmed_value=a.surname.upper(),
                    confidence=0.96,
                ),
                DocumentField(
                    document_id=id_doc.id,
                    field="date_of_birth",
                    llm_value=a.dob.isoformat(),
                    confirmed_value=a.dob.isoformat(),
                    confidence=0.94,
                ),
            ]
        )

        sittings = [(sitting_meta, a.grades, slip_read)]
        if a.resit:
            sittings.append((("JUNE", 2023, sitting_meta[2]), a.resit, slip_read + timedelta(minutes=4)))
        for (session, year, centre), grades, read_at in sittings:
            s = ExamSitting(
                application_id=app.id,
                level="O",
                session=session,
                year=year,
                centre_number=centre,
                candidate_number=candidate,
                candidate_name=(a.slip_name or name).upper(),
            )
            items = list(grades.items())
            slug = f"{session.lower()}-{year}"
            doc = self.document(
                app,
                "zimsec_o_slip",
                f"seed/applications/{a.ref}/zimsec-{slug}.svg",
                _slip_svg(a.slip_name or name, s, items),
                read_at,
                "phone (Android · Chrome)",
            )
            await self.db.flush()
            s.document_id = doc.id
            s.results = [
                ExamSubjectResult(subject_code=CODE.get(sub), subject_name=sub, grade=g) for sub, g in items
            ]
            self.db.add(s)
            for sub, g in items:
                first = a.unclear.get(sub)
                self.db.add(
                    DocumentField(
                        document_id=doc.id,
                        field=f"subjects.{CODE.get(sub)}.grade",
                        llm_value=first or g,
                        confirmed_value=g,
                        confidence=0.55 if first else 0.96,
                    )
                )
        birth = self.document(
            app,
            "birth_certificate",
            f"seed/applications/{a.ref}/birth-certificate.svg",
            _birth_svg(name, a.dob),
            id_read + timedelta(minutes=5),
            "phone (Android · Chrome)",
        )
        await self.db.flush()
        self.db.add_all(
            [
                DocumentField(document_id=birth.id, field="full_name", confirmed_value=name.upper()),
                DocumentField(document_id=birth.id, field="date_of_birth", confirmed_value=a.dob.isoformat()),
            ]
        )
        # Paid by EcoCash just before submitting (design/Submitted "receipt EC-8841027" for Tariro).
        app.declared_at = submitted - timedelta(minutes=2)
        self.db.add(
            ApplicationPayment(
                application_id=app.id,
                method="ecocash",
                status="paid",
                amount=Decimal(get_settings().application_fee_usd),
                phone=person.user.phone if person.user and person.user.phone else "+263770000001",
                provider="dev",
                receipt="EC-8841027"
                if a.ref == "APP-27-08813"
                else f"EC-{8840000 + len(a.ref) * 97 + int(a.ref[-3:]):07d}",
                paid_at=submitted,
                created_at=submitted - timedelta(minutes=1),
            )
        )
        for code, severity, text in a.flags:
            self.db.add(
                ApplicationFlag(
                    application_id=app.id,
                    code=code,
                    severity=severity,
                    detail={"text": text},
                    created_at=submitted,
                )
            )

        if events:
            ev = lambda **kw: self.db.add(ApplicationEvent(application_id=app.id, **kw))  # noqa: E731
            ev(kind="status", to_status="draft", created_at=started, via="computer")
            ev(kind="document", comment="National ID read", created_at=id_read, via="phone")
            n = len(a.unclear)
            ev(
                kind="document",
                comment="ZIMSEC slip read" + (f"; {n} unclear grades confirmed" if n else ""),
                created_at=slip_read,
                via="phone",
            )
            ev(
                kind="status",
                from_status="draft",
                to_status="submitted",
                created_at=submitted,
                actor_id=person.user_id,
            )
            if a.owner:
                ev(
                    kind="assigned",
                    comment="Assigned to C. Marufu",
                    created_at=self.at(0, "08:30"),
                    actor_id=self.officer.id,
                )
            if a.status in ("more_info", "accepted", "rejected"):
                decided = submitted + timedelta(days=1, hours=2)
                ev(
                    kind="status",
                    from_status="in_review",
                    to_status=a.status,
                    comment=a.decision,
                    visible_to_applicant=True,
                    created_at=decided,
                    actor_id=self.officer.id,
                )
                app.assigned_to = self.officer.id
                if a.status != "more_info":
                    app.decided_by, app.decided_at, app.decision_reason = self.officer.id, decided, a.decision
        return app

    def dev_applicant(self) -> None:
        """A new applicant with nothing started, to try the application flow from the beginning.
        Applicant usernames are the phone number without '+' (docs/design-handoff.md)."""
        u = User(
            idp_subject="seed:263772345678",
            username="263772345678",
            display_name="Chiedza Nyoni",
            phone="+263772345678",
        )
        u.roles = [UserRole(role="applicant", idp_group="portal-applicants")]
        self.db.add_all([u, Person(surname="Nyoni", first_names="Chiedza", user=u)])

    async def run(self, tariro: Person) -> None:
        self.reference_data()
        self.dev_applicant()
        # design/StaffReview: Tariro's application, in review with C. Marufu.
        tariro_app = Applicant(
            "APP-27-08813",
            "Tariro",
            "Moyo",
            "63-2047823 29",
            "DIT",
            2,
            "14:05",
            {
                "English Language": "B",
                "Mathematics": "C",
                "Physical Science": "B",
                "Computer Science": "A",
                "Geography": "C",
                "Shona": "B",
            },
            owner=True,
            status="in_review",
            unclear={"Physical Science": "8", "Geography": "G"},
            dob=tariro.date_of_birth,
        )
        number, reg, origin, valid = _id(tariro_app.id_raw, False)
        self.identity(tariro, number, reg, origin, valid)
        day = self.day0 - timedelta(days=2)
        await self.application(
            tariro_app,
            tariro,
            started=clock.at(day, time(9, 30)),
            id_read=clock.at(day, time(9, 41)),
            slip_read=clock.at(day, time(9, 52)),
        )
        for i, a in enumerate(APPLICANTS):
            number, reg, origin, valid = _id(a.id_raw, a.bad_letter)
            p = self.person_for(a, number, reg, origin, valid)
            await self.db.flush()
            sub = self.at(a.days_ago, a.at)
            candidate = "0457" if a.ref == "APP-27-08829" else f"{(311 + i * 37) % 10000:04d}"
            await self.application(
                a,
                p,
                started=sub - timedelta(hours=3),
                id_read=sub - timedelta(hours=2, minutes=40),
                slip_read=sub - timedelta(hours=2, minutes=20),
                sitting_meta=(
                    "NOVEMBER",
                    2022,
                    "123456" if a.ref == "APP-27-08829" else f"{120000 + i * 1311:06d}",
                ),
                candidate=candidate,
            )
