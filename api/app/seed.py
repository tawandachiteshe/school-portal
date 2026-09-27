"""Development seed: the sample data from the design files (design/*.dc.html).

    uv run python -m app.seed          # wipes portal data and re-creates it

Dates are relative to today so the dashboard always looks like the designs: the
current term is in week 6 of 16. Never runs in production.
"""

import asyncio
import sys
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import (
    AcademicTerm,
    Department,
    Enrolment,
    Intake,
    Module,
    ModuleOffering,
    OfferingLecturer,
    Person,
    Programme,
    ProgrammeModule,
    Staff,
    Student,
    User,
    UserRole,
    Venue,
)

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
        self.staff(
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

        await self.db.commit()


async def main() -> None:
    if get_settings().is_prod:
        sys.exit("Refusing to seed a production database.")
    async with get_sessionmaker()() as db:
        await db.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        await Seeder(db, date.today()).run()
    print("Seeded. Sign in at http://localhost:5173/login (development sign-in).")


if __name__ == "__main__":
    asyncio.run(main())
