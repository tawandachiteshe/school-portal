# TelOne Better Portal

A modern student onboarding and student-life portal for TelOne Centre for Learning (TCFL).

It replaces the manual, paper-heavy onboarding process with:

- **Document scanning with OCR.** Applicants upload or photograph their **ZIMSEC O/A-Level certificates and result slips**. The system reads the subjects, grades, candidate/centre numbers and exam session, then checks them against the entry requirements.
- **National ID decoding and validation.** The system reads the Zimbabwe national ID number, validates its **mod-23 check letter**, and decodes the registration and origin district codes.
- **A student dashboard.** It shows results, current modules and their lecturers, upcoming tests, assignments due, lecture notes, library information and announcements.
- **An AI assistant.** A chat helper answers questions about the student's own timetable, deadlines, notes and college policies, using only portal data the student is allowed to see.

> **Status:** project scaffolded. The design is final ([design/](design/), [docs/design-handoff.md](docs/design-handoff.md)). The web app has the design theme and restyled shadcn/ui primitives (Foundations page), and the API has health and national-ID decoding with tests. Next: app shells and the Authentik sign-in screens (build order in the handoff doc).

## Documentation

| # | Document | What's inside |
|---|----------|---------------|
| 1 | [Research](docs/01-research.md) | Problem, ZIMSEC document facts, Zimbabwe ID format, OCR options compared, legal context, sources |
| 2 | [Architecture](docs/02-architecture.md) | Components, tech stack, data model, repo layout, key flows |
| 3 | [OCR & ID pipeline](docs/03-ocr-and-id-pipeline.md) | How certificates, result slips and IDs are scanned, extracted, validated and reviewed |
| 4 | [AI assistant](docs/04-ai-assistant.md) | Chat design, retrieval, tools, guardrails, cost control |
| 5 | [Portal features](docs/05-portal-features.md) | Every module: results, modules/lecturers, tests, assignments, notes, library, announcements, and user roles |
| 6 | [Running the system](docs/06-running-the-system.md) | Prerequisites, env vars, local dev, Docker Compose, seeding, production deploy, backups |
| 7 | [Security & compliance](docs/07-security-and-compliance.md) | Cyber and Data Protection Act, POTRAZ licensing, data retention, access control |
| 8 | [Roadmap](docs/08-roadmap.md) | Phased delivery plan, pilot, success metrics |
| 9 | [Database design](docs/09-database-design.md) | ER diagram, every table by domain, audience/access rules, indexes, security, retention. Full DDL in [docs/database/schema.sql](docs/database/schema.sql) |
| 10 | [Authentication](docs/10-authentication.md) | Authentik as the identity provider: OIDC backend-for-frontend login, groups → roles, sign-up/MFA/recovery flows, account lifecycle, blueprints, hardening |

## Quick start

```bash
cp .env.example .env              # replace every change-me (see docs/06)
docker compose up -d --build      # postgres, redis, s3 (SeaweedFS), authentik, api, web
open http://localhost:5173        # portal (Foundations page for now)
open http://localhost:5173/auth/  # Authentik (admin at /auth/if/admin/)
open http://localhost:8000/docs   # API docs
```

Everyday commands are in the `Makefile`: `make` lists them. First run on this machine: `make setup`, then `make dev`.

Sample data (the people and modules in the designs): `docker compose exec api python -m app.seed`.
In development `/login` offers a sign-in as any seeded account (`DEV_LOGIN=true`, never in production).

Without Docker: `docker compose up -d postgres`, put `DATABASE_URL=postgresql+psycopg://portal:…@localhost:5432/portal`
in `api/.env` (set `POSTGRES_PORT` in `.env` if 5432 is taken), then `cd api && uv sync && uv run alembic upgrade head
&& uv run python -m app.seed && uv run uvicorn app.main:app --reload`, and `cd web && bun install && bun run dev`.
Tests: `cd web && bun run test`, `cd api && uv run pytest` (needs the Postgres container; creates a `portal_test` database). Production runs on Dokploy ([docs/06 §6.7](docs/06-running-the-system.md#67-production-deployment-dokploy)).
