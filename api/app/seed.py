"""Development seed: the sample data from the design files (design/*.dc.html).

    uv run python -m app.seed          # wipes portal data and re-creates it

Dates are relative to today so the dashboard always looks like the designs: the
current term is in week 6 of 16. Never runs in production.
"""

import asyncio
import re
import sys
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.config import get_settings
from app.db import get_sessionmaker
from app.models import (
    AcademicTerm,
    Announcement,
    AnnouncementRead,
    AnnouncementTarget,
    Assessment,
    CourseMaterial,
    Department,
    Enrolment,
    Intake,
    LibraryCopy,
    LibraryItem,
    LibraryLoan,
    Module,
    ModuleOffering,
    OfferingLecturer,
    Person,
    Programme,
    ProgrammeModule,
    Staff,
    Student,
    Submission,
    TimetableSlot,
    User,
    UserRole,
    Venue,
)
from app.seed_files import make_pdf
from app.services import clock

GROUPS = {
    "applicant": "portal-applicants",
    "student": "portal-students",
    "lecturer": "portal-lecturers",
    "admissions": "portal-admissions",
    "registry": "portal-registry",
    "librarian": "portal-librarians",
    "admin": "portal-admins",
    "student_affairs": "portal-student-affairs",
}

# Tables the seed owns; truncated (with CASCADE) before re-seeding.
TABLES = [
    "users",
    "people",
    "departments",
    "programmes",
    "academic_terms",
    "intakes",
    "modules",
    "venues",
    "staff",
    "students",
    "module_offerings",
    "announcements",
    "library_items",
]

ENGLISH_MATHS = {
    "min_passes": 5,
    "min_grade": "C",
    "level": "O",
    "required_subjects": ["English Language", "Mathematics"],
}


def term_start(today: date) -> date:
    """Monday of week 1, so that this week is week 6."""
    monday = today - timedelta(days=today.weekday())
    return monday - timedelta(weeks=5)


class Seeder:
    def __init__(self, db: AsyncSession, today: date):
        self.db = db
        self.today = today
        self._reads: list[Announcement] = []

    def user(self, username: str, *, surname: str, first_names: str, roles: list[str], **kw) -> Person:
        u = User(
            idp_subject=f"seed:{username}",
            username=username,
            display_name=f"{first_names.split()[0]} {surname}",
            email=kw.pop("email", None),
            email_verified=True,
            phone=kw.pop("phone", None),
        )
        u.roles = [UserRole(role=r, idp_group=GROUPS[r]) for r in roles]
        p = Person(surname=surname, first_names=first_names, user=u, **kw)
        self.db.add_all([u, p])
        return p

    def staff(
        self, username: str, number: str, title: str | None, first: str, surname: str, roles, **kw
    ) -> Staff:
        person = self.user(
            username, surname=surname, first_names=first, roles=roles, email=f"{username}@tcfl.ac.zw"
        )
        s = Staff(person=person, staff_number=number, title=title, work_email=f"{username}@tcfl.ac.zw", **kw)
        self.db.add(s)
        return s

    async def run(self) -> None:
        start = term_start(self.today)

        ict = Department(code="ICT", name="Information and Communication Technology")
        tel = Department(code="TEL", name="Telecommunications Engineering")
        self.db.add_all([ict, tel])

        dit = Programme(
            code="DIT",
            name="Diploma in Information Technology",
            level="diploma",
            department=ict,
            duration_terms=6,
            entry_rules=ENGLISH_MATHS,
        )
        dse = Programme(
            code="DSE",
            name="Diploma in Software Engineering",
            level="diploma",
            department=ict,
            duration_terms=6,
            entry_rules=ENGLISH_MATHS,
        )
        dte = Programme(
            code="DTE",
            name="Diploma in Telecommunications Engineering",
            level="diploma",
            department=tel,
            duration_terms=6,
            entry_rules={
                **ENGLISH_MATHS,
                "required_subjects": ["English Language", "Mathematics", "Physical Science"],
            },
        )
        ccn = Programme(
            code="CCN",
            name="Certificate in Computer Networking",
            level="certificate",
            department=ict,
            duration_terms=4,
            entry_rules=ENGLISH_MATHS,
        )
        self.db.add_all([dit, dse, dte, ccn])

        term = AcademicTerm(
            code="2027-S1",
            name="Semester 1 2027",
            starts_on=start,
            ends_on=start + timedelta(weeks=16, days=-3),
            is_current=True,
        )
        now = datetime.now(UTC)
        intake = Intake(
            code="2027-FEB",
            name="2027 intake",
            first_term=term,
            opens_at=now - timedelta(days=30),
            closes_at=now + timedelta(days=60),
        )
        self.db.add_all([term, intake])

        lab3 = Venue(code="LAB-3", name="Lab 3", building="Block C", capacity=40)
        b2 = Venue(code="LR-B2", name="Lecture Room B2", building="Block B", capacity=120)
        blockc = Venue(code="BLOCK-C", name="Block C", building="Block C", capacity=60)
        self.db.add_all([lab3, b2, blockc])

        modules = {
            "DCN201": Module(
                code="DCN201", name="Data Communications", credits=15, department=tel, coursework_weight=50
            ),
            "NET202": Module(code="NET202", name="Computer Networks", credits=15, department=ict),
            "PRG101": Module(code="PRG101", name="Programming Fundamentals", credits=15, department=ict),
            "MTH110": Module(code="MTH110", name="Engineering Mathematics", credits=10, department=ict),
        }
        self.db.add_all(modules.values())
        for code in modules:
            self.db.add(ProgrammeModule(programme=dit, module=modules[code], term_number=1))

        chikore = self.staff(
            "fchikore",
            "TCFL-S-0231",
            "Eng.",
            "Fungai",
            "Chikore",
            ["lecturer"],
            department=tel,
            position="Lecturer · Data Communications",
            consultation_hours="Tuesdays 14:00–16:00",
        )
        ncube = self.staff(
            "sncube",
            "TCFL-S-0112",
            "Dr",
            "Sipho",
            "Ncube",
            ["lecturer"],
            department=ict,
            position="Lecturer · Engineering Mathematics",
        )
        ndlovu = self.staff(
            "rndlovu",
            "TCFL-S-0178",
            "Mrs",
            "Rumbidzai",
            "Ndlovu",
            ["lecturer"],
            department=ict,
            position="Lecturer · Computer Networks",
        )
        mutasa = self.staff(
            "tmutasa",
            "TCFL-S-0204",
            "Mr",
            "Tendai",
            "Mutasa",
            ["lecturer"],
            department=ict,
            position="Lecturer · Programming",
        )
        self.staff(
            "cmarufu", "TCFL-S-0090", None, "Chipo", "Marufu", ["admissions"], position="Admissions officer"
        )
        self.staff(
            "schinembiri",
            "TCFL-S-0145",
            None,
            "Shamiso",
            "Chinembiri",
            ["librarian"],
            position="Librarian · Block A desk",
            office="Block A",
        )
        mushonga = self.staff(
            "tmushonga",
            "TCFL-S-0066",
            None,
            "Takudzwa",
            "Mushonga",
            ["student_affairs"],
            position="Student Affairs officer",
        )

        # Only lecturers go by title in the portal ("Eng. F. Chikore"); other staff by initial ("C. Marufu").
        lecturers = {"DCN201": chikore, "NET202": ndlovu, "PRG101": mutasa, "MTH110": ncube}
        offerings: dict[str, ModuleOffering] = {}
        for code, module in modules.items():
            o = ModuleOffering(module=module, term=term, class_group="DIT-1A")
            o.lecturers = [OfferingLecturer(staff=lecturers[code], role="lead")]
            offerings[code] = o
            self.db.add(o)
        # Eng. Chikore also teaches DCN201 to the telecoms class (design/LecturerHome).
        dte_dcn = ModuleOffering(module=modules["DCN201"], term=term, class_group="DTE-1A")
        dte_dcn.lecturers = [OfferingLecturer(staff=chikore, role="lead")]
        self.db.add(dte_dcn)

        tariro = self.user(
            "TCFL/2027/0142",
            surname="Moyo",
            first_names="Tariro",
            roles=["student"],
            phone="+263773184521",
            email="tariro.moyo@students.tcfl.ac.zw",
            gender="female",
            date_of_birth=date(2006, 4, 17),
        )
        student = Student(
            person=tariro,
            student_number="TCFL/2027/0142",
            programme=dit,
            intake=intake,
            current_term_number=1,
            class_group="DIT-1A",
            status="active",
        )
        self.db.add(student)
        await self.db.flush()
        for o in offerings.values():
            self.db.add(Enrolment(student_id=student.id, offering_id=o.id))

        venues = {"LAB-3": lab3, "LR-B2": b2, "BLOCK-C": blockc}
        self.timetable(offerings, venues)
        await self.db.flush()
        self.assessments(offerings, venues, student, lecturers)
        self.materials(offerings, lecturers)
        self.announcements(author_staff=mushonga, lab3=lab3, start=start)
        self.library(tariro)
        await self.db.flush()
        for a in self._reads:
            self.db.add(AnnouncementRead(announcement_id=a.id, user_id=tariro.user.id))
        await self.db.commit()

    # --- teaching data, all relative to "now" in Harare ------------------------------------

    # (module, ISO weekday, start, end, venue, kind). Thursday matches design/Main and Timetable.
    SLOTS = [
        ("DCN201", 1, "08:00", "09:30", "LR-B2", "lecture"),
        ("NET202", 1, "10:00", "11:30", "LAB-3", "lab"),
        ("PRG101", 1, "14:30", "16:00", "BLOCK-C", "lecture"),
        ("MTH110", 2, "08:00", "09:30", "LR-B2", "lecture"),
        ("PRG101", 2, "10:00", "11:30", "LAB-3", "lab"),
        ("NET202", 2, "12:00", "13:30", "LR-B2", "lecture"),
        ("DCN201", 3, "10:00", "11:30", "LAB-3", "tutorial"),
        ("MTH110", 3, "12:00", "13:30", "LR-B2", "tutorial"),
        ("MTH110", 4, "08:00", "09:30", "LR-B2", "lecture"),
        ("DCN201", 4, "10:00", "11:30", "LAB-3", "lecture"),
        ("NET202", 4, "12:00", "13:30", "LAB-3", "lab"),
        ("PRG101", 4, "14:30", "16:00", "BLOCK-C", "lecture"),
        ("PRG101", 5, "08:00", "09:30", "BLOCK-C", "lab"),
        ("NET202", 5, "10:00", "11:30", "LR-B2", "tutorial"),
    ]

    def timetable(self, offerings, venues) -> None:
        for code, dow, a, b, venue, kind in self.SLOTS:
            self.db.add(
                TimetableSlot(
                    offering=offerings[code],
                    day_of_week=dow,
                    starts_at=time.fromisoformat(a),
                    ends_at=time.fromisoformat(b),
                    venue=venues[venue],
                    kind=kind,
                )
            )

    def next_class(self, code: str) -> tuple[datetime, str]:
        """Start and venue code of the next class of a module at or after now."""
        now = clock.now()
        for i in range(8):
            d = now.date() + timedelta(days=i)
            for c, dow, a, _b, venue, _k in self.SLOTS:
                t = clock.at(d, time.fromisoformat(a))
                if c == code and dow == d.isoweekday() and t >= now:
                    return t, venue
        raise AssertionError(code)

    def assessments(self, offerings, venues, student, lecturers) -> None:
        now = clock.now()
        # Test 1 is sat in the next DCN201 class, so it's always "coming up" (design/Main).
        test1_at, test1_venue = self.next_class("DCN201")
        today = now.date()

        def local(days: int, hhmm: str) -> datetime:
            return clock.at(today + timedelta(days=days), time.fromisoformat(hhmm))

        def add(code, kind, title, due, weight, **kw):
            a = Assessment(
                offering=offerings[code],
                kind=kind,
                title=title,
                due_at=due,
                weight=weight,
                created_by=lecturers[code].person.user.id,
                published_at=now - timedelta(days=21),
                **kw,
            )
            self.db.add(a)
            return a

        a1 = add(
            "DCN201",
            "assignment",
            "Assignment 1: Signal types",
            local(-26, "17:00"),
            10,
            max_mark=20,
            marks_released_at=now - timedelta(days=12),
        )
        self.db.add(
            Submission(
                assessment=a1,
                student=student,
                status="marked",
                submitted_at=local(-27, "21:40"),
                mark=16,
                marked_at=now - timedelta(days=12),
                feedback_md="Clear diagrams. Label the axes on every waveform next time.",
            )
        )
        add(
            "DCN201",
            "test",
            "Test 1: Signals and modulation",
            test1_at,
            15,
            venue=venues[test1_venue],
            duration_minutes=90,
            submission_mode="none",
        )
        add("DCN201", "assignment", "Assignment 2: Line coding", local(28, "17:00"), 10)
        add(
            "DCN201",
            "test",
            "Test 2: Multiplexing and error control",
            local(49, "10:00"),
            15,
            venue=venues["LAB-3"],
            duration_minutes=90,
            submission_mode="none",
        )
        add(
            "PRG101",
            "assignment",
            "Lab sheet 4: Loops and arrays",
            local(1, "17:00"),
            5,
            accepted_extensions=[".c", ".pdf"],
            max_file_mb=10,
            description_md="Complete exercises 1 to 6. Upload your .c file, or a PDF with your code and output.",
        )
        add(
            "PRG101",
            "assignment",
            "Lab sheet 5: Functions",
            local(8, "17:00"),
            5,
            accepted_extensions=[".c", ".pdf"],
        )
        add(
            "NET202",
            "practical",
            "Cable termination practical",
            local(9, "12:00"),
            10,
            venue=venues["LAB-3"],
            duration_minutes=90,
            submission_mode="none",
        )
        mth1 = add(
            "MTH110",
            "test",
            "Test 1: Limits and continuity",
            local(-20, "08:00"),
            15,
            venue=venues["LR-B2"],
            duration_minutes=90,
            submission_mode="none",
            max_mark=40,
            marks_released_at=now - timedelta(days=9),
        )
        self.db.add(
            Submission(
                assessment=mth1,
                student=student,
                status="marked",
                mark=29,
                marked_at=now - timedelta(days=9),
                feedback_md="Good on limits. Revise the squeeze theorem: question 4 lost most marks.",
            )
        )
        sub = add("NET202", "assignment", "Subnetting worksheet", local(4, "23:59"), 5)
        self.db.add(
            Submission(
                assessment=sub, student=student, status="submitted", submitted_at=now - timedelta(hours=20)
            )
        )
        add(
            "MTH110",
            "test",
            "Test 2: Differentiation",
            local(6, "08:00"),
            15,
            venue=venues["LR-B2"],
            duration_minutes=90,
            submission_mode="none",
        )

    # (module, title, week, size, age). All PDFs: they're generated so downloads work.
    MATERIALS = [
        ("DCN201", "Amplitude and frequency modulation", 6, 1_200_000, timedelta(hours=2)),
        ("NET202", "IPv4 subnetting worked examples", 6, 3_400_000, timedelta(days=1)),
        ("PRG101", "Arrays in C: lecture notes", 5, 640_000, timedelta(days=5)),
        ("DCN201", "Test 1 revision questions", 5, 310_000, timedelta(days=7)),
        ("DCN201", "Analogue and digital signals", 4, 4_800_000, timedelta(days=14)),
        ("DCN201", "Digital modulation: ASK, FSK and PSK", 5, 1_300_000, timedelta(days=10)),
        ("DCN201", "Transmission media", 3, 920_000, timedelta(days=21)),
        ("DCN201", "Assignment 1 brief: signal types", 2, 180_000, timedelta(days=30)),
        ("DCN201", "Signals, bandwidth and data rate", 2, 1_600_000, timedelta(days=30)),
        ("DCN201", "The OSI and TCP/IP models", 1, 2_100_000, timedelta(days=36)),
        ("DCN201", "Module outline and assessment plan", 1, 150_000, timedelta(days=37)),
        ("NET202", "Network topologies", 4, 1_100_000, timedelta(days=15)),
        ("PRG101", "Loops: while, do-while and for", 4, 520_000, timedelta(days=12)),
        ("MTH110", "Differentiation: rules and examples", 5, 880_000, timedelta(days=6)),
    ]

    def materials(self, offerings, lecturers) -> None:
        now = clock.now()
        bucket = get_settings().s3_bucket_content
        try:
            storage.ensure_buckets()
            upload = True
        except Exception as e:  # storage not running: seed the rows anyway
            print(f"Object storage unavailable ({e.__class__.__name__}); notes will not download.")
            upload = False
        for code, title, week, size, ago in self.MATERIALS:
            slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
            key = f"seed/materials/{code}/{slug}.pdf"
            if upload:
                pdf = make_pdf(
                    title, [f"{code} · Week {week}", "Sample course note for the development seed."], size
                )
                storage.put(bucket, key, pdf, "application/pdf")
            self.db.add(
                CourseMaterial(
                    offering=offerings[code],
                    title=title,
                    week=week,
                    mime_type="application/pdf",
                    size_bytes=size,
                    object_key=key,
                    uploaded_by=lecturers[code].person.user.id,
                    published_at=now - ago,
                )
            )

    def announcements(self, author_staff, lab3, start: date) -> None:
        now = clock.now()
        today = now.date()
        author = author_staff.person.user.id

        def long(d: date) -> str:
            return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"

        fees_due = start + timedelta(weeks=11, days=2)  # Wednesday of week 12
        friday = today + timedelta(days=(4 - today.weekday()) % 7 or 7)
        briefing = today + timedelta(days=(1 - today.weekday()) % 7 or 7)  # next Tuesday
        rows = [
            dict(
                title=f"Second fees instalment due {long(fees_due)}",
                from_label="Accounts Office",
                is_pinned=True,
                publish_at=now - timedelta(days=9),
                contact_line="Questions: Accounts Office, Block A",
                body_md=f"The second instalment of Semester 1 fees is due on {long(fees_due)}. Use your student "
                "number as the payment reference. Your balance is on the Fees page.",
                roles=["student"],
            ),
            dict(
                title=f"Lab 3 closed on {long(friday)} for network maintenance",
                from_label="ICT Services",
                publish_at=now - timedelta(hours=1),
                contact_line="Questions: ICT Services, Block C",
                affects_venue=lab3,
                affects_on=friday,
                body_md=f"We're replacing the core switch in Lab 3. The lab will be closed all day on {long(friday)}, "
                "from 07:00 until 18:00.\n\nClasses booked in Lab 3 that day move to Lab 1. Your lecturer "
                "will confirm. Printing in Block C is not affected.\n\nIf the work finishes early, we'll "
                "post an update here.",
                roles=[None],
            ),
            dict(
                title=f"Industrial attachment briefing for Year 1: {long(briefing)}, 14:00, Lecture Room B2",
                from_label="Student Affairs",
                publish_at=now - timedelta(days=1),
                contact_line="Questions: Student Affairs, Block A",
                body_md="All Year 1 students must attend. We'll explain how attachment placements work, the forms "
                "you need, and key dates for next year. Bring a pen and your student card. The briefing "
                "takes about an hour.",
                roles=["student"],
                term_number=1,
            ),
            dict(
                title="Library open until 20:00 on weekdays from this week",
                from_label="Library",
                publish_at=now - timedelta(days=12),
                read=True,
                contact_line="Questions: Library desk, Block A",
                body_md="The library in Block A is now open until 20:00, Monday to Friday. Saturday hours stay "
                "08:00 to 13:00.",
                roles=["student"],
            ),
            dict(
                title="Semester 1 test dates published for all Year 1 classes",
                from_label="Examinations Office",
                publish_at=now - timedelta(days=20),
                read=True,
                body_md="Test dates for every Year 1 module are now on the Deadlines page. Check them against your "
                "timetable and tell your lecturer about any clash.",
                roles=["student"],
                term_number=1,
            ),
        ]
        for r in rows:
            roles = r.pop("roles")
            term_number = r.pop("term_number", None)
            read = r.pop("read", False)
            venue = r.pop("affects_venue", None)
            a = Announcement(author_id=author, affects_venue_id=venue.id if venue else None, **r)
            a.targets = [AnnouncementTarget(role=role, term_number=term_number) for role in roles]
            self.db.add(a)
            if read:
                self._reads.append(a)

    def library(self, tariro: Person) -> None:
        now = clock.now()
        books = [
            ("Engineering Mathematics", ["K. A. Stroud"], "510 STR", "TCFL-B-001873"),
            ("Data Communications and Networking", ["B. A. Forouzan"], "004.6 FOR", "TCFL-B-003390"),
            ("Computer Networks", ["A. S. Tanenbaum"], "004.6 TAN", "TCFL-B-002214"),
        ]
        copies = {}
        for title, authors, call, barcode in books:
            item = LibraryItem(title=title, authors=authors, call_number=call)
            copy = LibraryCopy(item=item, barcode=barcode, location=f"Block A · shelf {call}")
            self.db.add_all([item, copy])
            copies[title] = copy
        copies["Engineering Mathematics"].status = "on_loan"
        copies["Data Communications and Networking"].status = "on_loan"
        self.db.add_all(
            [
                LibraryLoan(
                    copy=copies["Engineering Mathematics"],
                    person=tariro,
                    borrowed_at=now - timedelta(days=17),
                    due_at=now - timedelta(days=3),
                ),
                LibraryLoan(
                    copy=copies["Data Communications and Networking"],
                    person=tariro,
                    borrowed_at=now - timedelta(days=23),
                    due_at=now + timedelta(days=5),
                    renewals=1,
                ),
            ]
        )


async def main() -> None:
    if get_settings().is_prod:
        sys.exit("Refusing to seed a production database.")
    async with get_sessionmaker()() as db:
        await db.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        await Seeder(db, date.today()).run()
    print("Seeded. Sign in at http://localhost:5173/login (development sign-in).")


if __name__ == "__main__":
    asyncio.run(main())
