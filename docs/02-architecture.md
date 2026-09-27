# 2. Architecture

## 2.1 Overview

```
                    ┌────────────────────────────────────────────┐      sign-in / sign-up / MFA
  Applicant /       │  web  (React + Vite + shadcn/ui, PWA)      │ ───── redirects ─────┐
  Student /  ─────▶ │  - onboarding wizard + camera capture       │                      │
  Lecturer / Staff  │  - student dashboard, staff console, chat   │                      ▼
                    └───────────────┬────────────────────────────┘      ┌───────────────────────────┐
                                    │ HTTPS, session cookie             │ Authentik (/auth/ path)   │
                                    │ (JSON + SSE for chat)             │ OIDC provider · flows ·   │
                    ┌───────────────▼────────────────────────────┐      │ MFA · groups · LDAP/AD    │
                    │  api  (FastAPI, Python 3.12)               │◀────▶│ own Postgres              │
                    │  auth (OIDC BFF) · onboarding · academics  │ OIDC └───────────────────────────┘
                    │  content · library · notifications · chat  │ + admin API (groups, invites)
                    └──┬─────────┬──────────┬──────────┬─────────┘
                       │         │          │          │
              ┌────────▼──┐ ┌────▼────┐ ┌───▼─────┐ ┌──▼──────────────┐
              │ PostgreSQL│ │  Redis  │ │ MinIO   │ │ Claude API      │
              │ + pgvector│ │ queue / │ │ (S3)    │ │ (vision extract │
              │           │ │ cache   │ │ scans,  │ │  + chat)        │
              └────────▲──┘ └────┬────┘ │ notes   │ └──▲──────────────┘
                       │         │      └───▲─────┘    │
                    ┌──┴─────────▼──────────┴──────────┴─┐
                    │ worker (Celery)                    │
                    │ OCR pipeline (OpenCV + PaddleOCR)  │
                    │ embeddings, reminders, email/SMS   │
                    └────────────────────────────────────┘
```

## 2.2 Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **React 19 + TypeScript**, built with **Vite** as a single-page app (SPA) | FastAPI is the only backend. The portal is behind a login, so SEO and server rendering add nothing. The build is plain static files served by a small nginx container behind Dokploy's Traefik, with no JS runtime in production. |
| Frontend tooling | **Bun** (package manager + script runner), lockfile `bun.lock` | Installs are much faster than npm; one tool for install, scripts and `bunx`. Vite, shadcn CLI and Vitest all run under it. |
| UI components | **shadcn/ui** (Radix primitives + Tailwind CSS v4), `lucide-react` icons | Accessible components (dialogs, forms, tables, tabs, toasts) whose source is copied into the repo, so we own and theme them in TCFL colours. Dark mode works out of the box. |
| Frontend libraries | React Router (routing), TanStack Query (API data and caching), React Hook Form + Zod (forms and validation, the shadcn `Form` pattern), `openapi-typescript` (types generated from FastAPI's OpenAPI schema), `vite-plugin-pwa` (installable app and offline cache) | Mobile-first, because most applicants use phones. Timetables and notes stay viewable offline once cached. |
| API | **FastAPI** (Python 3.12), Pydantic v2, SQLAlchemy 2, Alembic | Python is where the OCR ecosystem lives; auto-generated OpenAPI docs |
| Background jobs | **Celery** + Redis | OCR is slow (1–10 s/page); keep it off the request thread |
| OCR | **OpenCV** (preprocess) + **PaddleOCR** (primary) + **Tesseract** (fallback) | See [research §1.4](01-research.md#14-ocr-technology-options) |
| LLM | **Claude** via the official `anthropic` Python SDK — model `claude-opus-5` (configurable) | Structured extraction from images; student assistant |
| Database | **PostgreSQL 16** + **pgvector** | Relational academic data + vector search for the assistant in one DB |
| Object storage | **MinIO** (S3-compatible, self-hosted) | Scans and lecture notes stay on-premises |
| Auth | **Authentik** (self-hosted identity provider) over OIDC. FastAPI is a confidential client using the **backend-for-frontend** pattern: authorization code + PKCE, with the browser holding only an httpOnly session cookie. Roles come from Authentik groups. See [10-authentication.md](10-authentication.md). | Sign-up, MFA, passkeys, SMS verification, password recovery, and LDAP/AD for staff, all without building auth ourselves. Credentials stay on campus. The same identity provider can later front Moodle, Koha and Wi-Fi. |
| Notifications | Email (SMTP), SMS gateway (e.g. local bulk-SMS provider), Web Push | Deadline and announcement reminders |
| Deployment | **Dokploy** (self-hosted PaaS): Compose deployment, Traefik routing and Let's Encrypt TLS | The ICT team deploys from git through a web UI on one server, with no hand-written proxy config |
| Observability | Structured JSON logs, Prometheus metrics, Sentry (self-hosted optional) | |

## 2.3 Repository layout (target)

```
telone-better-portal/
├── README.md
├── docs/                       # these documents
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── api/
│   ├── pyproject.toml
│   ├── alembic/                # migrations
│   └── app/
│       ├── main.py             # FastAPI app factory
│       ├── config.py           # pydantic-settings, reads .env
│       ├── db.py
│       ├── auth/               # OIDC client (Authentik), sessions, role sync, Authentik API client
│       ├── onboarding/         # applications, documents, review queue
│       ├── ocr/
│       │   ├── preprocess.py   # deskew, denoise, crop, perspective fix
│       │   ├── engines.py      # PaddleOCR / Tesseract wrappers
│       │   ├── zimsec.py       # result-slip & certificate parser
│       │   ├── national_id.py  # ID regex, mod-23 check, district decode
│       │   ├── llm_extract.py  # Claude structured extraction
│       │   └── eligibility.py  # programme entry-requirement rules
│       ├── academics/          # programmes, modules, lecturers, results
│       ├── content/            # notes, assignments, tests, announcements
│       ├── library/
│       ├── assistant/          # chat, retrieval, tools
│       ├── notifications/
│       ├── workers/            # celery tasks
│       └── scripts/            # seed_demo, import_csv, etc.
│   └── tests/
└── web/                          # React + Vite SPA
    ├── package.json
    ├── vite.config.ts            # dev proxy /api → api:8000, PWA plugin
    ├── components.json           # shadcn/ui config
    ├── index.html
    └── src/
        ├── main.tsx              # QueryClientProvider + RouterProvider
        ├── routes.tsx            # route table + role guards
        ├── layouts/
        │   ├── PublicLayout.tsx
        │   ├── StudentLayout.tsx # sidebar/bottom nav
        │   └── StaffLayout.tsx
        ├── pages/
        │   ├── apply/            # onboarding wizard (steps, camera capture)
        │   ├── dashboard/
        │   ├── modules/          # list + ModuleDetail (:moduleId)
        │   ├── results/
        │   ├── library/
        │   ├── assistant/
        │   ├── admissions/       # review queue (staff)
        │   └── lecturer/
        ├── components/
        │   ├── ui/               # shadcn/ui generated components (button, card, form, table…)
        │   └── …                 # app components (DeadlineCard, DocumentCapture, ReviewPane)
        ├── hooks/                # useAuth, useDashboard, useChatStream …
        └── lib/
            ├── api.ts            # fetch wrapper: cookie session, CSRF header, 401 → /api/auth/login
            ├── api-types.ts      # generated by openapi-typescript
            └── utils.ts          # shadcn `cn()` helper
```

Routes are grouped by layout and guarded by role. For example, `/admissions/*` needs `admissions` or `admin`. The guard is only for the user experience; the API still enforces every permission.

## 2.4 Data model

The full design is in **[09-database-design.md](09-database-design.md)**, with runnable DDL in [database/schema.sql](database/schema.sql). In short:

- **Identity:** `users` (login) → `people` (the human, with the national ID encrypted and hashed) → `students` / `staff`.
- **Onboarding:** `applications` → `documents` → `document_fields`; `exam_sittings` → `exam_subject_results`; `application_flags`; ZIMSEC verification batches.
- **Teaching:** `programmes` ↔ `modules` → `module_offerings` (module × term × class group) → `offering_lecturers`, `enrolments`, `timetable_slots`.
- **Assessment:** `assessments` → `submissions`; `module_results` are gated by `results_published_at`.
- **Content:** `course_materials`, `announcements` + `announcement_targets` (audience rules).
- **Library:** `library_items` → `library_copies` → `library_loans`; `library_pages`.
- **Assistant:** `kb_documents` (visibility scope) → `kb_chunks` (pgvector); `chat_sessions` → `chat_messages`.
- **Compliance:** partitioned `audit_log`, `data_subject_requests`, `retention_runs`.

Access rules shared by the dashboard and the assistant are SQL functions: `kb_visible_documents(user)` and `announcements_for_user(user)`.

## 2.5 Key flows

### Onboarding

```
Applicant                    web                 api                    worker
   │ create account ─────────▶│──────────────────▶│
   │ capture ID + ZIMSEC docs▶│ upload (presigned)▶│ documents.status=uploaded
   │                          │                    │── enqueue ocr(doc) ───▶│ preprocess → OCR → parse
   │                          │                    │                        │ → (LLM extract if needed)
   │                          │◀─── SSE progress ──│◀── extracted_json ─────│
   │ review & correct fields ▶│───────────────────▶│ status=confirmed
   │                          │                    │ eligibility.evaluate()
   │ submit ─────────────────▶│───────────────────▶│ status=submitted → admissions queue
Admissions officer ──────────▶│ side-by-side image + fields, flags ──▶ approve / request info / reject
                              │                    │ on accept: create student, student_number, enrolments
```

### Student dashboard

One call `GET /me/dashboard` returns: today's classes, next 7 days of tests & assignments, unread announcements, latest notes, library loans due, latest published results. Cached per user in Redis for 60 s; invalidated on relevant writes.

### Assistant

`POST /assistant/chat` (SSE stream) → retrieve permitted chunks → call Claude with tools
(`get_my_timetable`, `get_my_deadlines`, `get_my_results`, `search_library`, …) → stream answer with citations. See [04-ai-assistant.md](04-ai-assistant.md).

## 2.6 Integrations

| System | Direction | Method |
|--------|-----------|--------|
| Existing student records / ERP | in/out | Nightly CSV/API sync job (`scripts/import_csv.py`) until an API exists |
| Existing LMS (Moodle, if used) | in | Moodle Web Services: courses, assignments, grades → `module_offerings`, `assessments`, `results` |
| Finance / fees | in | Fee-clearance flag per student (blocks results view if policy requires) |
| Library system (Koha, if used) | in | Koha REST API / Z39.50 for catalogue + loans |
| ZIMSEC | out | Batch export of claims for confirmation; manual status update |
| Email/SMS | out | SMTP + SMS gateway |

Each integration is an adapter behind an interface, so the portal runs standalone with its own data first and connects to other systems as they become available.
