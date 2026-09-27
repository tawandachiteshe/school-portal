# TCFL Portal

Mobile-first web app for TelOne Centre for Learning (Harare, Zimbabwe). It replaces paper-based
student onboarding and gives students one place for modules, lecturers, deadlines, notes, results,
library and announcements. Staff (admissions, lecturers, librarians, Student Affairs) use it on laptops.

## Stack

- React + TypeScript + Vite (SPA, Bun), shadcn/ui, Tailwind CSS v4 (theme in `web/src/globals.css`)
- API: FastAPI (Python 3.12+, uv), PostgreSQL 16 + pgvector, Redis, MinIO, Celery; Claude for OCR structuring + assistant
- Icons: lucide-react, `strokeWidth={1.5}`, 16–20px, only where they aid recognition
- Fonts: IBM Plex Sans (UI), IBM Plex Mono (IDs, codes, numbers that are identifiers)
- Auth: Authentik, served under `/auth/` on the portal origin. The React app renders its own screens by driving
  Authentik's flow executor API (`/auth/api/v3/flows/executor/<slug>/`) and mapping each challenge component to a
  screen; FastAPI then completes OIDC as a BFF and sets an httpOnly session cookie (docs/10-authentication.md)
- Deploy: Dokploy (Compose, `docker-compose.prod.yml`, Traefik routes `/`, `/api`, `/auth`). No Caddy/nginx proxy config in repo

## The design is the spec

- `design/*.dc.html` — one file per screen, exported from the design canvas. Read the markup:
  inline styles and `design/tcfl.css` classes give exact spacing, sizes and colours. They use the
  canvas template syntax (`{{hole}}`, `<sc-if>`, `<sc-for>`, `<dc-import>`, a `DCLogic` script) and
  need the canvas runtime to render, so for visuals use the canvas:
  https://claude.ai/artifact/3GHcmx3QTz2ZRYjf2ykGzP
- `design/canvas.json` — which screens exist, their titles and grouping (`page`).
- `docs/design-handoff.md` — screen inventory, routes, states, component mapping, open questions.
- Build screens to match the files. When a file and this doc disagree, ask.

## Design rules (non-negotiable)

- Serious institutional product: GOV.UK clarity, Linear restraint, Stripe-dashboard density for staff.
- NO purple/indigo gradients, gradient text, glassmorphism, blur, glows, coloured shadows, emoji,
  sparkle icons, "AI-powered" copy, decorative icons in pastel circles, centred heroes, stock art,
  fake stats or charts, lorem ipsum.
- Hierarchy through size, weight and spacing, not boxes. Most content is plain lists with 1px hairline
  dividers. Cards (`bg-card border rounded-md`) only for real separate objects (options, dialogs, the student card).
- No shadows. 1px borders only. Radius 6px (buttons, cards, alerts), 4px (inputs, badges).
- 4px grid. Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Colour: neutral warm greys; `primary` blue only for primary actions, links, current state.
  `urgent` (amber) ONLY for items due within 48 hours and low-confidence scanned fields.
  Status colours: success green, destructive red, info blue.
- Body text ≥16px on mobile. 14px for meta. 12px only for badges and bottom-nav labels.
  Tabular figures everywhere. Identifiers (student no., national ID, module codes, references) in mono.
- Touch targets ≥44px. Visible focus ring (2px ring, 2px offset). WCAG 2.2 AA contrast.
- Motion: 150ms fades/slides for state changes only; respect prefers-reduced-motion.
- Copy is plain and specific: "DCN201 test on Thursday at 10:00 in Lab 3", not "You have an upcoming assessment!".
- Fast on 3G: no heavy images, show cached data offline, warn before large downloads, queue uploads.

## Layouts

- Students: 360–390px first. Top bar (wordmark, "Ask TCFL" text button, avatar) + bottom nav
  Home · Modules · Deadlines · Library · More. Sub-pages use a back-arrow header, no bottom nav.
- Applicants: top bar + step indicator with names (Programme · National ID · ZIMSEC results · Review · Submit).
  Desktop 1280 uses the same steps as underlined tabs.
- Staff: 1280px, 240px left sidebar (role-specific nav, user at bottom), 56px top bar, dense tables (40px rows).

## Sample data

Use the sample data in the design files (Tariro Moyo, TCFL/2027/0142, DIT-1A, 63-2047823 Q 29, etc.)
for seeds and Storybook. Values marked `[LIKE THIS]` in the designs are unknowns — do not invent them.

## Repo layout

- `web/` — React app. `src/components/ui/` shadcn primitives restyled to `design/tcfl.css`; `src/pages/`, `src/routes.tsx`
  (routes from docs/design-handoff.md); `src/lib/` (utils, theme). Fonts self-hosted via @fontsource (Latin only).
- `api/` — FastAPI. `app/main.py`, `app/config.py`, `app/ocr/national_id.py` (mod-23 ID check), tests in `api/tests/`.
- `design/` — the design spec (read-only). `docs/` — research, architecture, DB design (`docs/database/schema.sql`),
  auth, running guide. `infra/authentik/blueprints/` — Authentik config as code.
- `docker-compose.yml` (dev), `docker-compose.prod.yml` (Dokploy), `.env.example` (all settings).

## Commands

- Web (in `web/`): `bun install`, `bun run dev` (http://localhost:5173, proxies `/api` and `/auth`), `bun run build`,
  `bun run test` (Vitest), `bun run lint` (oxlint), `bun run gen:api` (types from FastAPI OpenAPI).
- API (in `api/`): `uv sync`, `uv run uvicorn app.main:app --reload`, `uv run pytest`, `uv run ruff check . && uv run ruff format .`
- Full stack: `cp .env.example .env && docker compose up -d --build`.
- Adding a shadcn component: `bunx --bun shadcn@latest add <name>`, then fix the import to `@/lib/utils` and strip
  shadows / `ring-[3px]` / `outline-none` to match the rules above.

