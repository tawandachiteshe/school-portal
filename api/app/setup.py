"""Setting up a real deployment (docs/06 §6.7). Every command can be run again safely.

  python -m app.setup reference [--districts districts.csv] [--subjects subjects.csv]
      Departments, programmes and entry rules, National ID district codes, ZIMSEC O-Level subjects.
      CSV columns: districts `code,district,province`; subjects `code,name` (O-Level).
  python -m app.setup intake --code 2027-FEB --name "2027 intake" --opens 2026-10-01 --closes 2026-11-30
                             [--classes-start 2027-02-01]
      Creates or updates the intake applicants apply to. With --classes-start, also its first semester
      (shown on the landing page and in offer letters).
  python -m app.setup check
      What's configured and what isn't. Exits 1 if something would stop the portal working.

Unlike app.seed, this never deletes anything and never adds sample people.
"""

import argparse
import asyncio
import csv
import sys
from datetime import date, time, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import mail, storage
from app.config import get_settings
from app.db import get_sessionmaker
from app.models import AcademicTerm, Department, DistrictCode, Intake, Programme, ZimsecSubject
from app.reference_data import DEPARTMENTS, DISTRICTS, PROGRAMMES, SUBJECTS
from app.services import clock


def _rows(path: str | None, columns: list[str]) -> list[dict[str, str]]:
    if not path:
        return []
    with Path(path).open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    missing = set(columns) - set(rows[0] if rows else columns)
    if missing:
        sys.exit(f"{path}: missing columns {', '.join(sorted(missing))}")
    return rows


async def reference(db: AsyncSession, districts_csv: str | None, subjects_csv: str | None) -> None:
    depts = {d.code: d for d in (await db.execute(select(Department))).scalars()}
    for code, name in DEPARTMENTS.items():
        depts.setdefault(code, Department(code=code, name=name)).name = name
        db.add(depts[code])
    await db.flush()
    for code, p in PROGRAMMES.items():
        row = (await db.execute(select(Programme).where(Programme.code == code))).scalar_one_or_none()
        row = row or Programme(code=code)
        row.name, row.award, row.level = p.name, p.award, p.level
        row.department_id, row.duration_terms, row.entry_rules = (
            depts[p.department].id,
            p.terms,
            p.entry_rules,
        )
        db.add(row)

    districts: dict[str, tuple[str, str | None]] = dict(DISTRICTS)
    districts |= {
        r["code"].strip().zfill(2): (r["district"].strip(), r["province"].strip() or None)
        for r in _rows(districts_csv, ["code", "district", "province"])
    }
    for code, (district, province) in districts.items():
        await db.merge(DistrictCode(code=code, district=district, province=province))

    subjects = dict(SUBJECTS) | {
        r["code"].strip(): r["name"].strip() for r in _rows(subjects_csv, ["code", "name"])
    }
    for code, name in subjects.items():
        await db.merge(ZimsecSubject(code=code, level="O", name=name))
    await db.commit()
    print(f"Reference data: {len(DEPARTMENTS)} departments, {len(PROGRAMMES)} programmes, ", end="")
    print(f"{len(districts)} district codes, {len(subjects)} ZIMSEC subjects.")


async def intake(db: AsyncSession, a: argparse.Namespace) -> None:
    if a.closes <= a.opens:
        sys.exit("--closes must be after --opens")
    row = (await db.execute(select(Intake).where(Intake.code == a.code))).scalar_one_or_none() or Intake(
        code=a.code
    )
    row.name = a.name
    row.opens_at = clock.at(a.opens, time(0, 0))
    row.closes_at = clock.at(a.closes, time(23, 59))
    if a.classes_start:
        code = f"{a.classes_start.year}-S1"
        term = (await db.execute(select(AcademicTerm).where(AcademicTerm.code == code))).scalar_one_or_none()
        term = term or AcademicTerm(code=code, is_current=False)
        term.name = f"Semester 1 {a.classes_start.year}"
        term.starts_on, term.ends_on = a.classes_start, a.classes_start + timedelta(weeks=16, days=-3)
        db.add(term)
        await db.flush()
        row.first_term_id = term.id
    db.add(row)
    await db.commit()
    print(f"Intake {row.code} ({row.name}): open {a.opens:%d %b %Y} to {a.closes:%d %b %Y} (Harare time).")


async def check(db: AsyncSession) -> int:
    s = get_settings()
    problems, notes = [], []

    def secret(name: str, value: str) -> None:
        if not value or "change-me" in value:
            problems.append(f"{name} isn't set")

    secret("SECRET_KEY", s.secret_key)
    secret("SESSION_ENCRYPTION_KEY", s.session_encryption_key)
    secret("OIDC_CLIENT_SECRET", s.oidc_client_secret)
    secret("S3_SECRET_KEY", s.s3_secret_key)
    secret(
        "SMS_WEBHOOK_SECRET", s.sms_webhook_secret if s.sms_webhook_secret != "dev-sms-webhook-secret" else ""
    )
    if not s.is_prod:
        problems.append("APP_ENV isn't production (session cookies aren't Secure, development sign-in is on)")
    if not s.oidc_issuer.startswith("https://"):
        problems.append(f"OIDC_ISSUER isn't https: {s.oidc_issuer}")

    programmes = await db.scalar(
        select(func.count()).select_from(Programme).where(Programme.is_accepting_applications)
    )
    if not programmes:
        problems.append("No programmes: run `python -m app.setup reference`")
    now = clock.now()
    open_intake = (
        await db.execute(select(Intake).where(Intake.opens_at <= now, Intake.closes_at > now))
    ).scalar_one_or_none()
    if open_intake is None:
        notes.append("No intake is open now (`python -m app.setup intake …`); applicants can't submit")

    try:
        storage.ensure_buckets()
    except Exception as e:  # noqa: BLE001 - reported, not raised
        problems.append(f"Object storage: {e}")
    try:
        base = s.oidc_internal_base_url or "{0.scheme}://{0.netloc}".format(urlsplit(s.oidc_issuer))
        r = httpx.get(f"{base}/auth/-/health/ready/", timeout=5)
        if r.status_code != 200:
            problems.append(f"Authentik isn't ready ({r.status_code})")
    except httpx.HTTPError as e:
        problems.append(f"Authentik can't be reached: {e}")
    if not s.authentik_api_token or s.authentik_api_token == "change-me":
        notes.append("AUTHENTIK_API_TOKEN isn't set: password reset by code won't work")

    notes.append("Email: " + ("SMTP_HOST set" if mail.configured() else "no SMTP_HOST, nothing is emailed"))
    notes.append(
        "Ask TCFL: "
        + ("configured" if s.anthropic_api_key else "no ANTHROPIC_API_KEY, it says it isn't set up")
    )
    notes.append("Google sign-in: " + ("on" if s.google_client_id else "off"))
    notes.append(
        "Mobile money: "
        + (s.payment_provider or "none")
        + "; bank transfer: "
        + ("on" if s.bank_account_number else "off")
    )

    for p in problems:
        print(f"PROBLEM  {p}")
    for n in notes:
        print(f"note     {n}")
    print("Ready." if not problems else f"{len(problems)} problem(s).")
    return 1 if problems else 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.setup", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    ref = sub.add_parser("reference", help="programmes, district codes, ZIMSEC subjects")
    ref.add_argument("--districts", help="CSV: code,district,province")
    ref.add_argument("--subjects", help="CSV: code,name")
    it = sub.add_parser("intake", help="create or update an intake")
    it.add_argument("--code", required=True, help="2027-FEB")
    it.add_argument("--name", required=True, help='"2027 intake"')
    it.add_argument("--opens", required=True, type=date.fromisoformat, help="YYYY-MM-DD")
    it.add_argument("--closes", required=True, type=date.fromisoformat, help="YYYY-MM-DD")
    it.add_argument("--classes-start", type=date.fromisoformat, help="YYYY-MM-DD, first day of classes")
    sub.add_parser("check", help="what's configured and what isn't")
    a = parser.parse_args()

    async def run() -> int:
        async with get_sessionmaker()() as db:
            if a.command == "reference":
                await reference(db, a.districts, a.subjects)
            elif a.command == "intake":
                await intake(db, a)
            else:
                return await check(db)
        return 0

    sys.exit(asyncio.run(run()))


if __name__ == "__main__":
    main()
