"""Development seed: the sample data from the design files (design/*.dc.html).

    uv run python -m app.seed                        # wipes portal data and re-creates it
    uv run python -m app.seed --results-published    # …with this semester's results published

Dates are relative to today so the dashboard always looks like the designs: the
current term is in week 6 of 16. Never runs in production.
"""

import asyncio
import re
import sys
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

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
    FeeDueDate,
    FeeTransaction,
    Intake,
    LibraryCopy,
    LibraryItem,
    LibraryLoan,
    LibraryReservation,
    MaterialDownload,
    Module,
    ModuleOffering,
    ModuleResult,
    OfferingLecturer,
    Person,
    Programme,
    ProgrammeModule,
    ReadingListItem,
    Staff,
    Student,
    Submission,
    TimetableSlot,
    User,
    UserRole,
    Venue,
)
from app.pdf import make_pdf
from app.reference_data import DEPARTMENTS, PROGRAMMES
from app.seed_admissions import AdmissionsSeed, user_of
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
    "accounts": "portal-accounts",
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
    "district_codes",
    "zimsec_subjects",
]


def term_start(today: date) -> date:
    """Monday of week 1, so that this week is week 6."""
    monday = today - timedelta(days=today.weekday())
    return monday - timedelta(weeks=5)


class Seeder:
    def __init__(self, db: AsyncSession, today: date, results_published: bool = False):
        self.results_published = results_published
        self.db = db
        self.today = today
        self._reads: list[Announcement] = []
        self.materials_by: dict[tuple[str, str], CourseMaterial] = {}
        self.pending_loans: list[tuple[LibraryCopy, str, int]] = []  # (copy, student number, days late)

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
            username, surname=surname, first_names=first, roles=roles, email=f"{username}@example.ac.zw"
        )
        s = Staff(
            person=person, staff_number=number, title=title, work_email=f"{username}@example.ac.zw", **kw
        )
        self.db.add(s)
        return s

    async def run(self) -> None:
        start = term_start(self.today)

        depts = {code: Department(code=code, name=name) for code, name in DEPARTMENTS.items()}
        progs = {
            code: Programme(
                code=code,
                name=p.name,
                award=p.award,
                level=p.level,
                department=depts[p.department],
                duration_terms=p.terms,
                entry_rules=p.entry_rules,
            )
            for code, p in PROGRAMMES.items()
        }
        self.db.add_all([*depts.values(), *progs.values()])
        ict, tel = depts["ICT"], depts["TEL"]
        dit, dse, dte, ccn = (progs[c] for c in ("DIT", "DSE", "DTE", "CCN"))

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
            "CC-S-0231",
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
            "CC-S-0112",
            "Dr",
            "Sipho",
            "Ncube",
            ["lecturer"],
            department=ict,
            position="Lecturer · Engineering Mathematics",
        )
        ndlovu = self.staff(
            "rndlovu",
            "CC-S-0178",
            "Mrs",
            "Rumbidzai",
            "Ndlovu",
            ["lecturer"],
            department=ict,
            position="Lecturer · Computer Networks",
        )
        mutasa = self.staff(
            "tmutasa",
            "CC-S-0204",
            "Mr",
            "Tendai",
            "Mutasa",
            ["lecturer"],
            department=ict,
            position="Lecturer · Programming",
        )
        marufu = self.staff(
            "cmarufu", "CC-S-0090", None, "Chipo", "Marufu", ["admissions"], position="Admissions officer"
        )
        self.staff(
            "schinembiri",
            "CC-S-0145",
            None,
            "Shamiso",
            "Chinembiri",
            ["librarian"],
            position="Librarian · Block A desk",
            office="Block A",
        )
        # Accounts: confirms bank and cash application fees. Not in the designs; a placeholder name.
        self.staff(
            "nmapfumo", "CC-S-0104", None, "Nyasha", "Mapfumo", ["accounts"], position="Accounts officer"
        )
        mushonga = self.staff(
            "tmushonga",
            "CC-S-0066",
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
        self.dte_dcn = dte_dcn

        tariro = self.user(
            "CC/2027/0142",
            surname="Moyo",
            first_names="Tariro",
            # Still an applicant too: her application is in review (design/Status, StaffReview).
            roles=["student", "applicant"],
            phone="+263773184521",
            email="tariro.moyo@students.example.ac.zw",
            gender="female",
            date_of_birth=date(2006, 5, 14),
        )
        student = Student(
            person=tariro,
            student_number="CC/2027/0142",
            programme=dit,
            intake=intake,
            current_term_number=1,
            class_group="DIT-1A",
            status="active",
        )
        self.db.add(student)
        self.tariro_user = user_of(tariro)
        await self.db.flush()
        for o in offerings.values():
            self.db.add(Enrolment(student_id=student.id, offering_id=o.id))

        venues = {"LAB-3": lab3, "LR-B2": b2, "BLOCK-C": blockc}
        self.timetable(offerings, venues)
        await self.db.flush()
        self.assessments(offerings, venues, student, lecturers)
        self.materials(offerings, lecturers)
        self.announcements(author_staff=mushonga, lab3=lab3, start=start)
        self.library(tariro, offerings, [lec.person for lec in lecturers.values()])
        self.fees(student, term, start)
        self.results(student, offerings, lecturers)
        await self.db.flush()
        await self.classmates(dit, dte, intake, offerings, lecturers)
        programmes = {p.code: p for p in (dit, dse, dte, ccn)}
        await AdmissionsSeed(self.db, intake, programmes, marufu.person).run(tariro)
        for a in self._reads:
            self.db.add(AnnouncementRead(announcement_id=a.id, user_id=self.tariro_user.id))
        await self.db.commit()

    # --- classmates: full classes for the lecturer screens --------------------------------------

    # design/LecturerMarks and Register: the first students in DIT-1A (Tariro is 0142).
    DIT_NAMES = [
        ("0107", "Banda", "Takudzwa"),
        ("0111", "Chigumba", "Ropafadzo"),
        ("0114", "Chikomo", "Anesu"),
        ("0119", "Dzvova", "Munyaradzi"),
        ("0123", "Gova", "Tanatswa"),
        ("0126", "Hove", "Simbarashe"),
        ("0130", "Jambwa", "Chiedza"),
        ("0135", "Madziva", "Rufaro"),
        ("0138", "Mapfumo", "Kundai"),
        ("0147", "Mpofu", "Thandeka"),
        ("0151", "Mudzingwa", "Panashe"),
        ("0154", "Mukwena", "Tafadzwa"),
        ("0158", "Musonza", "Farai"),
        ("0161", "Ncube", "Sibusiso"),
        ("0165", "Ndoro", "Ruvimbo"),
        ("0168", "Nyamande", "Tinotenda"),
        ("0172", "Nyoni", "Busisiwe"),
        ("0175", "Rusike", "Tapiwa"),
        ("0179", "Shumba", "Tawanda"),
        ("0182", "Sibanda", "Lindiwe"),
        ("0186", "Takawira", "Kudakwashe"),
        ("0189", "Tembo", "Rutendo"),
        ("0193", "Zhou", "Tatenda"),
        ("0196", "Zulu", "Nkosana"),
        ("0101", "Chari", "Vimbai"),
        ("0102", "Chinyama", "Blessing"),
        ("0103", "Dube", "Mthokozisi"),
        ("0104", "Gumbo", "Nyasha"),
        ("0105", "Hlatshwayo", "Nomsa"),
        ("0106", "Kamba", "Fadzai"),
        ("0109", "Kufa", "Tonderai"),
        ("0112", "Machingura", "Ashley"),
        ("0116", "Makoni", "Tendai"),
        ("0121", "Manyika", "Shingai"),
        ("0128", "Mhlanga", "Chipo"),
        ("0132", "Moyo", "Brian"),
        ("0140", "Mpala", "Thabani"),
    ]  # 37 + Tariro = 38 (design: "38 students")
    DTE_SURNAMES = [
        "Bhebhe",
        "Chakanyuka",
        "Chauke",
        "Chidza",
        "Chimombe",
        "Chirwa",
        "Chitsva",
        "Dhliwayo",
        "Gava",
        "Gwatidzo",
        "Jonga",
        "Kadzere",
        "Katsande",
        "Mabhena",
        "Madondo",
        "Mafuta",
        "Magaya",
        "Mahachi",
        "Makumbe",
        "Mandaza",
        "Marange",
        "Masaka",
        "Matanga",
        "Mavhunga",
        "Mhaka",
        "Moyo",
        "Mudarikwa",
        "Mugabe",
        "Mukanya",
        "Mupfumi",
        "Murwira",
        "Mushore",
        "Mutero",
        "Nhari",
        "Nyathi",
        "Nzira",
        "Rukweza",
        "Sithole",
        "Tshuma",
        "Zengeni",
        "Zinyama",
    ]  # 41 (design: DTE-1A 41)
    DTE_FIRST = [
        "Tanaka",
        "Rudo",
        "Kuda",
        "Mufaro",
        "Tatenda",
        "Chengetai",
        "Tinashe",
        "Rumbi",
        "Tapfuma",
        "Ngoni",
    ]

    # Classmates who are also test personas (docs: Campus Portal test personas) can sign in: Thandeka is
    # Tariro's classmate, to check one student never sees another's records.
    PERSONA_CLASSMATES = {"CC/2027/0147": "+263772100147"}

    def person_user(self, number: str, surname: str, first: str) -> Person:
        # Other classmates have portal records but no sign-in (no username).
        phone = self.PERSONA_CLASSMATES.get(number)
        u = User(
            idp_subject=f"seed:{number}",
            username=number if phone else None,
            display_name=f"{first} {surname}",
            email_verified=True,
            phone=phone,
        )
        u.roles = [UserRole(role="student", idp_group=GROUPS["student"])]
        p = Person(surname=surname, first_names=first, user=u)
        self.db.add_all([u, p])
        return p

    async def classmates(self, dit, dte, intake, offerings, lecturers) -> None:
        now = clock.now()
        dit_students, dte_students = [], []
        for n, surname, first in self.DIT_NAMES:
            st = Student(
                person=self.person_user(f"CC/2027/{n}", surname, first),
                student_number=f"CC/2027/{n}",
                programme=dit,
                intake=intake,
                class_group="DIT-1A",
            )
            self.db.add(st)
            dit_students.append(st)
        for i, surname in enumerate(self.DTE_SURNAMES):
            n = f"CC/2027/{201 + i * 3:04d}"
            st = Student(
                person=self.person_user(n, surname, self.DTE_FIRST[i % len(self.DTE_FIRST)]),
                student_number=n,
                programme=dte,
                intake=intake,
                class_group="DTE-1A",
            )
            self.db.add(st)
            dte_students.append(st)
        await self.db.flush()
        for st in dit_students:
            for o in offerings.values():
                self.db.add(Enrolment(student_id=st.id, offering_id=o.id))
        for st in dte_students:
            self.db.add(Enrolment(student_id=st.id, offering_id=self.dte_dcn.id))

        # design/LecturerHome "Assignment 1 · DTE-1A · 35 of 41 marked · results due Fri 12 Mar · due tomorrow"
        a = Assessment(
            offering=self.dte_dcn,
            kind="assignment",
            title="Assignment 1: Signal types",
            due_at=now - timedelta(days=9),
            weight=10,
            max_mark=20,
            created_by=lecturers["DCN201"].person.user.id,
            published_at=now - timedelta(days=30),
            marks_due_on=now.date() + timedelta(days=1),
        )
        self.db.add(a)
        await self.db.flush()
        for i, st in enumerate(dte_students):
            marked = i < 35
            self.db.add(
                Submission(
                    assessment_id=a.id,
                    student_id=st.id,
                    status="marked" if marked else "submitted",
                    submitted_at=now - timedelta(days=10, hours=i % 7),
                    mark=(9 + (i * 7) % 12) if marked else None,
                    marked_at=now - timedelta(days=1) if marked else None,
                )
            )

        # design/LibraryOverdue: two second-years with long-overdue books (reminded by SMS a week ago).
        year2 = []
        for number, surname, first, programme, group, phone in (
            ("CC/2026/0388", "Gumbo", "Tapiwa", dte, "DTE-2A", "+263772210388"),
            ("CC/2026/0214", "Chikwanha", "Blessing", dit, "DIT-2B", "+263712660214"),
        ):
            p = self.person_user(number, surname, first)
            user_of(p).phone = phone
            st = Student(
                person=p,
                student_number=number,
                programme=programme,
                intake=intake,
                class_group=group,
                current_term_number=3,
            )
            self.db.add(st)
            year2.append(st)
        await self.db.flush()
        by_number = {st.student_number: st.person for st in [*dit_students, *dte_students, *year2]}
        for copy, number, days in self.pending_loans:
            reminded = number.startswith("CC/2026")
            self.db.add(
                LibraryLoan(
                    copy=copy,
                    person=by_number[number],
                    borrowed_at=now - timedelta(days=14 + days),
                    due_at=now - timedelta(days=days),
                    last_reminder_at=now - timedelta(days=days - 7) if reminded else None,
                    last_reminder_channel="sms" if reminded else None,
                )
            )

        # The DIT-1A Assignment 1 is marked and published (Tariro has 16/20): mark her classmates too.
        for i, st in enumerate(dit_students):
            self.db.add(
                Submission(
                    assessment_id=self.a1_dit.id,
                    student_id=st.id,
                    status="marked",
                    submitted_at=self.a1_dit.due_at - timedelta(hours=2 + i % 20),
                    mark=8 + (i * 5) % 13,
                    marked_at=now - timedelta(days=12),
                )
            )

        # design/LecturerHome "Downloaded by": 24/79, 35/38, 71/79 (Tariro hasn't opened the first or last).
        dit_users = [user_of(st.person) for st in dit_students]
        dte_users = [user_of(st.person) for st in dte_students]
        await self.db.flush()
        for title, count in (
            ("Amplitude and frequency modulation", 24),
            ("Analogue and digital signals", 71),
        ):
            everyone = [(u, "DIT-1A") for u in dit_users] + [(u, "DTE-1A") for u in dte_users]
            for u, cg in everyone[:count]:
                m = self.materials_by[(title, cg)]
                assert m.published_at  # every seeded note is published
                self.db.add(
                    MaterialDownload(
                        material_id=m.id,
                        user_id=u.id,
                        first_at=m.published_at + timedelta(hours=3),
                        last_at=m.published_at + timedelta(hours=3),
                    )
                )
        rev = self.materials_by[("Test 1 revision questions", "DIT-1A")]
        for u in [self.tariro_user, *dit_users[:34]]:
            self.db.add(MaterialDownload(material_id=rev.id, user_id=u.id))

    # --- teaching data, all relative to "now" in Harare ------------------------------------

    # (module, ISO weekday, start, end, venue, kind). Thursday matches design/Main and Timetable.
    SLOTS = [
        # design/DeskTimetable week grid; agrees with Modules ("MTH110 Next: Mon 10:00, Lecture Room B2")
        # and DeskModule ("DCN201 · Mondays 08:00 Lecture Room B2, Thursdays 10:00 Lab 3").
        ("DCN201", 1, "08:00", "09:30", "LR-B2", "lecture"),
        ("MTH110", 1, "10:00", "11:30", "LR-B2", "lecture"),
        ("PRG101", 1, "14:00", "16:00", "BLOCK-C", "lab"),
        ("NET202", 2, "08:00", "09:30", "LAB-3", "lecture"),
        ("PRG101", 2, "10:00", "11:30", "BLOCK-C", "lecture"),
        ("MTH110", 3, "08:00", "09:00", None, "tutorial"),
        ("NET202", 3, "14:00", "16:00", "LAB-3", "lab"),
        ("MTH110", 4, "08:00", "09:30", "LR-B2", "lecture"),
        ("DCN201", 4, "10:00", "11:30", "LAB-3", "lecture"),
        ("NET202", 4, "12:00", "13:30", "LAB-3", "lecture"),
        ("PRG101", 4, "14:30", "16:00", "BLOCK-C", "lecture"),
        ("PRG101", 5, "10:00", "11:00", "BLOCK-C", "tutorial"),
    ]

    def timetable(self, offerings, venues) -> None:
        for code, dow, a, b, venue, kind in self.SLOTS:
            self.db.add(
                TimetableSlot(
                    offering=offerings[code],
                    day_of_week=dow,
                    starts_at=time.fromisoformat(a),
                    ends_at=time.fromisoformat(b),
                    venue=venues[venue] if venue else None,
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
                if c == code and venue and dow == d.isoweekday() and t >= now:
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

        a1 = self.a1_dit = add(
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
            max_mark=50,
            marks_due_on=test1_at.date() + timedelta(days=14),
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
    # Ages give design/Main's three newest notes and design/Modules' "1 new note" on DCN201 and NET202 only.
    MATERIALS = [
        ("DCN201", "Amplitude and frequency modulation", 6, 1_200_000, timedelta(hours=2)),
        ("NET202", "IPv4 subnetting worked examples", 6, 3_400_000, timedelta(days=1)),
        ("PRG101", "Arrays in C: lecture notes", 5, 640_000, timedelta(days=8)),
        ("DCN201", "Test 1 revision questions", 5, 310_000, timedelta(days=7)),
        ("DCN201", "Analogue and digital signals", 4, 4_800_000, timedelta(days=14)),
        ("DCN201", "Digital modulation: ASK, FSK and PSK", 5, 1_300_000, timedelta(days=16)),
        ("DCN201", "Transmission media", 3, 920_000, timedelta(days=21)),
        ("DCN201", "Assignment 1 brief: signal types", 2, 180_000, timedelta(days=30)),
        ("DCN201", "Signals, bandwidth and data rate", 2, 1_600_000, timedelta(days=30)),
        ("DCN201", "The OSI and TCP/IP models", 1, 2_100_000, timedelta(days=36)),
        ("DCN201", "Module outline and assessment plan", 1, 150_000, timedelta(days=37)),
        ("NET202", "Network topologies", 4, 1_100_000, timedelta(days=15)),
        ("PRG101", "Loops: while, do-while and for", 4, 520_000, timedelta(days=12)),
        ("MTH110", "Differentiation: rules and examples", 5, 880_000, timedelta(days=12)),
    ]

    DIT_ONLY = {"Test 1 revision questions", "Assignment 1 brief: signal types"}

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
                storage.put_sync(bucket, key, pdf, "application/pdf")
            targets = [offerings[code]]
            # design/LecturerHome: Eng. Chikore shares most DCN201 notes with both classes.
            if code == "DCN201" and title not in self.DIT_ONLY:
                targets.append(self.dte_dcn)
            for o in targets:
                m = CourseMaterial(
                    offering=o,
                    title=title,
                    week=week,
                    mime_type="application/pdf",
                    size_bytes=size,
                    object_key=key,
                    uploaded_by=lecturers[code].person.user.id,
                    published_at=now - ago,
                )
                self.db.add(m)
                self.materials_by[(title, o.class_group)] = m

    def announcements(self, author_staff, lab3, start: date) -> None:
        now = clock.now()
        today = now.date()
        author = author_staff.person.user.id

        def long(d: date) -> str:
            return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"

        fees_due = start + timedelta(weeks=11, days=2)  # Wednesday of week 12
        friday = today + timedelta(days=(4 - today.weekday()) % 7 or 7)
        briefing = today + timedelta(days=(1 - today.weekday()) % 7 or 7)  # next Tuesday
        rows: list[dict[str, Any]] = [
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
            a = Announcement(
                author_id=author,
                affects_venue_id=venue.id if venue else None,
                dispatched_at=r["publish_at"],
                **r,
            )
            a.targets = [AnnouncementTarget(role=role, term_number=term_number) for role in roles]
            self.db.add(a)
            if read:
                self._reads.append(a)

    def fees(self, student, term, start: date) -> None:
        # design/Fees: tuition charged in week 1, first instalment paid a week later, second due in week 12.
        self.db.add_all(
            [
                FeeTransaction(
                    student=student,
                    term=term,
                    kind="charge",
                    description="Semester 1 tuition",
                    amount=620,
                    occurred_on=start,
                ),
                FeeTransaction(
                    student=student,
                    term=term,
                    kind="payment",
                    description="Payment, instalment 1",
                    amount=-310,
                    occurred_on=start + timedelta(days=7),
                    receipt_ref="R-27-01934",
                ),
                FeeDueDate(
                    student=student,
                    term=term,
                    label="Second instalment",
                    amount=310,
                    due_on=start + timedelta(weeks=11, days=2),
                ),
            ]
        )

    # design/Results: coursework, exam, final.
    RESULTS = {"DCN201": (72, 64, 68), "NET202": (78, 70, 74), "PRG101": (85, 77, 81), "MTH110": (61, 49, 55)}

    def results(self, student, offerings, lecturers) -> None:
        for code, (cw, ex, final) in self.RESULTS.items():
            self.db.add(
                ModuleResult(
                    student=student,
                    offering=offerings[code],
                    coursework_mark=cw,
                    exam_mark=ex,
                    final_mark=final,
                    grade="Pass",
                    is_pass=True,
                    entered_by=lecturers[code].person.user.id,
                )
            )
            if self.results_published:
                offerings[code].results_published_at = clock.now() - timedelta(days=1)

    # (key, title, authors, edition, year, call number, copies: list of barcode → holder)
    # holder: None = on the shelf, "tariro" = on loan to Tariro, "other" = on loan to staff,
    # "held" = kept at the desk for Tariro's reservation. Availability matches design/Library.
    BOOKS = [
        (
            "stroud",
            "Engineering Mathematics",
            ["K. A. Stroud", "D. J. Booth"],
            "7th edition",
            2013,
            "510 STR",
            {"CC-B-001873": "tariro", "CC-B-001874": "late:CC/2027/0130:2"},
        ),
        (
            "forouzan",
            "Data Communications and Networking",
            ["B. A. Forouzan"],
            "5th edition",
            2012,
            "004.6 FOR",
            {"CC-B-003390": "tariro", "CC-B-003391": "late:CC/2027/0147:1"},
        ),
        (
            "tanenbaum",
            "Computer Networks",
            ["A. S. Tanenbaum", "D. J. Wetherall"],
            "5th edition",
            2011,
            "004.6 TAN",
            {"CC-B-004512": "held", "CC-B-002215": "late:CC/2027/0126:6"},
        ),
        (
            "stallings",
            "Data and Computer Communications",
            ["W. Stallings"],
            "10th edition",
            2013,
            "004.6 STA",
            {"CC-B-003512": None, "CC-B-003513": "other"},
        ),
        (
            "tomasi",
            "Electronic Communications Systems",
            ["W. Tomasi"],
            "5th edition",
            2003,
            "621.382 TOM",
            {"CC-B-002877": None},
        ),
        (
            "frenzel",
            "Principles of Electronic Communication Systems",
            ["L. E. Frenzel"],
            "4th edition",
            2015,
            "621.382 FRE",
            {"CC-B-003104": "other"},
        ),
        (
            "kurose",
            "Computer Networking: A Top-Down Approach",
            ["J. F. Kurose", "K. W. Ross"],
            "7th edition",
            2016,
            "004.6 KUR",
            {"CC-B-003655": "other", "CC-B-003656": "other"},
        ),
        (
            "odom",
            "CCNA 200-301 Official Cert Guide, Volume 1",
            ["W. Odom"],
            None,
            2019,
            "004.6 ODO",
            {"CC-B-003801": "other"},
        ),
        (
            "kr",
            "The C Programming Language",
            ["B. W. Kernighan", "D. M. Ritchie"],
            "2nd edition",
            1988,
            "005.133 KER",
            {"CC-B-001220": None, "CC-B-001221": None},
        ),
        (
            "king",
            "C Programming: A Modern Approach",
            ["K. N. King"],
            "2nd edition",
            2008,
            "005.133 KIN",
            {"CC-B-001340": None},
        ),
        (
            "bird",
            "Higher Engineering Mathematics",
            ["J. Bird"],
            "8th edition",
            2017,
            "510 BIR",
            {"CC-B-001902": None, "CC-B-001903": "other"},
        ),
        # design/LibraryOverdue: books out with other students
        (
            "kochan",
            "Programming in C",
            ["S. G. Kochan"],
            "4th edition",
            2014,
            "005.133 KOC",
            {"CC-B-001410": "late:CC/2027/0111:8"},
        ),
        (
            "floyd",
            "Digital Electronics",
            ["T. L. Floyd"],
            "11th edition",
            2015,
            "621.381 FLO",
            {"CC-B-002630": "late:CC/2026/0388:17"},
        ),
        (
            "connolly",
            "Database Systems",
            ["T. Connolly", "C. Begg"],
            "6th edition",
            2014,
            "005.74 CON",
            {"CC-B-003020": "late:CC/2026/0214:14"},
        ),
        (
            "stroud-adv",
            "Advanced Engineering Mathematics",
            ["K. A. Stroud", "D. J. Booth"],
            "5th edition",
            2011,
            "510 STR",
            {"CC-B-001880": "other"},
        ),
    ]
    READING_LISTS = {
        "DCN201": [
            ("forouzan", "Core text. Chapters 1 to 5 this semester."),
            ("stallings", None),
            ("tomasi", None),
            ("frenzel", None),
        ],
        "NET202": [("tanenbaum", "Core text."), ("kurose", None), ("odom", "For the CCNA practicals.")],
        "PRG101": [("kr", "Core text."), ("king", "Easier to follow if you're new to C.")],
        "MTH110": [("stroud", "Core text."), ("bird", None), ("stroud-adv", "For the later topics.")],
    }

    def library(self, tariro: Person, offerings, borrowers: list[Person]) -> None:
        now = clock.now()
        items: dict[str, LibraryItem] = {}
        others = iter(borrowers * 4)
        for key, title, authors, edition, year, call, copies in self.BOOKS:
            item = LibraryItem(title=title, authors=authors, edition=edition, year=year, call_number=call)
            items[key] = item
            self.db.add(item)
            for barcode, holder in copies.items():
                copy = LibraryCopy(item=item, barcode=barcode, location=f"Block A · shelf {call}")
                self.db.add(copy)
                if holder in ("tariro", "other") or (holder and holder.startswith("late:")):
                    copy.status = "on_loan"
                if holder and holder.startswith("late:"):
                    _, number, days = holder.split(":")
                    self.pending_loans.append((copy, number, int(days)))
                if holder == "tariro" and key == "stroud":  # overdue (design: "Overdue since Mon 8 Mar")
                    self.db.add(
                        LibraryLoan(
                            copy=copy,
                            person=tariro,
                            borrowed_at=now - timedelta(days=17),
                            due_at=now - timedelta(days=3),
                        )
                    )
                elif holder == "tariro":  # "Due Tue 16 Mar · 1 of 2 renewals left"
                    self.db.add(
                        LibraryLoan(
                            copy=copy,
                            person=tariro,
                            borrowed_at=now - timedelta(days=23),
                            due_at=now + timedelta(days=5),
                            renewals=1,
                        )
                    )
                elif holder == "other":
                    self.db.add(
                        LibraryLoan(
                            copy=copy,
                            person=next(others),
                            borrowed_at=now - timedelta(days=4),
                            due_at=now + timedelta(days=10),
                        )
                    )
                elif holder == "held":  # "Reserved · Collect from the desk by Sat 13 Mar · Ready"
                    self.db.add(
                        LibraryReservation(
                            item=item,
                            person=tariro,
                            status="ready",
                            copy=copy,
                            created_at=now - timedelta(days=6),
                            ready_at=now - timedelta(days=1),
                            collect_by=now.date() + timedelta(days=2),
                        )
                    )
        for code, rows in self.READING_LISTS.items():
            for i, (key, note) in enumerate(rows):
                self.db.add(
                    ReadingListItem(
                        offering=offerings[code], item=items[key], note=note, is_core=i == 0, sort_order=i
                    )
                )


async def main() -> None:
    if get_settings().is_prod and not get_settings().demo:
        sys.exit("Refusing to seed a production database (DEMO=true allows it on a pitch site).")
    async with get_sessionmaker()() as db:
        await db.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        await Seeder(db, date.today(), results_published="--results-published" in sys.argv).run()
    print("Seeded. Sign in at http://localhost:5173/login (development sign-in).")


if __name__ == "__main__":
    asyncio.run(main())
