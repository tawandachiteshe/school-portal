# 6. Running the System

This guide covers local development, production deployment on **Dokploy**, operations, and troubleshooting. The files it refers to are the real ones in the repo; read those for exact settings instead of copies here.

| File | What it is |
|------|------------|
| `docker-compose.yml` | Local development stack |
| `docker-compose.prod.yml` | Production stack, deployed by Dokploy |
| `.env.example` | Every environment variable, with dev defaults |
| `api/Dockerfile` | API image: targets `dev`, `prod`, `worker` (with the OCR stack) |
| `web/Dockerfile`, `web/nginx.conf` | React build, served as static files by nginx |
| `web/vite.config.ts` | Dev proxy: `/api` → FastAPI, `/auth` → Authentik |
| `infra/authentik/blueprints/` | Authentik configuration as code |

## 6.1 Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker Engine + Compose plugin | 24+ / v2 | Runs the whole stack |
| Git | any | |
| uv | 0.5+ | Python toolchain for the API outside Docker (`curl -LsSf https://astral.sh/uv/install.sh \| sh`) |
| Bun | 1.2+ | Frontend toolchain outside Docker (`curl -fsSL https://bun.sh/install \| bash`) |
| (Optional) NVIDIA GPU + container toolkit | | Faster PaddleOCR for large intakes |

**Server sizing (production, one intake of ~2,000 applicants):** 8 vCPU, 16 GB RAM, 200 GB SSD, Ubuntu 24.04 LTS. OCR on CPU handles about 5–10 pages per minute per worker, so run 2–4 workers during intake peaks.

**Accounts and keys:** an Anthropic API key (for LLM extraction and the assistant; optional if both are disabled), SMTP credentials, and SMS gateway credentials (optional).

## 6.2 Configuration

Copy `.env.example` to `.env` and replace every `change-me` (`openssl rand -base64 48` for secrets). Never commit `.env`. The groups in the file are core, database/cache/storage, OCR and Claude, **auth** (the portal as an OIDC client of Authentik), **Authentik itself**, notifications, and retention.

Everything runs on **one origin**, so there's no CORS configuration and cookies just work:

| Path | Goes to | Dev (Vite proxy) | Prod (Dokploy / Traefik) |
|------|---------|------------------|--------------------------|
| `/` | React app | Vite dev server | `web:80` (nginx) |
| `/api/*` | FastAPI (prefix stripped) | `api:8000` | `api:8000`, strip path **on** |
| `/auth/*` | Authentik (`AUTHENTIK_WEB__PATH=/auth/`) | `authentik-server:9000`, original Host kept | `authentik-server:9000`, strip path **off** |

Authentik lives under `/auth/` on the portal origin, not on its own subdomain, because the React sign-in screens call Authentik's flow-executor API directly and need its session cookie ([10 §10.2](10-authentication.md#102-architecture-backend-for-frontend-bff)).

## 6.3 Local development with Docker Compose

```bash
git clone <repo-url> telone-better-portal && cd telone-better-portal
cp .env.example .env                       # edit values

docker compose up -d --build
# Authentik starts, creates akadmin (AUTHENTIK_BOOTSTRAP_PASSWORD) and applies
# infra/authentik/blueprints/*.yaml: groups, the tcfl-portal OIDC provider and flows.
docker compose logs -f authentik-worker | grep -i blueprint   # wait for "applied" (Ctrl-C)
```

Then create the tables and buckets, load the sample data, and give every sample account an Authentik sign-in:

```bash
docker compose exec api alembic upgrade head          # create tables
docker compose exec api python -m app.storage         # create the S3 buckets
docker compose exec api python -m app.seed            # sample data from the designs (development only; wipes the database)
docker compose exec api python -m app.authentik_dev   # an Authentik user for each sample account, password tcfl-dev-2027
```

Open:
- Portal: http://localhost:5173 (the Foundations page shows the design tokens and primitives)
- API docs (Swagger): http://localhost:8000/docs, or through the proxy at http://localhost:5173/api/docs
- Authentik: http://localhost:5173/auth/ (admin at `/auth/if/admin/`, user `akadmin`)
- Object storage (SeaweedFS S3 API): http://localhost:8333

The sample accounts are test personas, one for each role and application stage: [11-test-personas.md](11-test-personas.md) lists them and what to test with each. Sign in at http://localhost:5173/login, or pick one at http://localhost:5173/login/dev without a password.

## 6.4 Running without Docker (API/web only)

```bash
# Backing services still run in Docker
docker compose up -d postgres redis s3 authentik-db authentik-server authentik-worker

# API (uv manages the venv and lockfile)
cd api
uv sync                                   # add --extra ocr for PaddleOCR/OpenCV (needs: apt install tesseract-ocr libgl1)
uv run uvicorn app.main:app --reload      # http://localhost:8000
uv run pytest                             # tests
uv run ruff check . && uv run ruff format .

# Web (Bun + Vite)
cd web
bun install
AUTH_PROXY_TARGET=http://localhost:9000 bun run dev   # http://localhost:5173
```

Outside Docker, Authentik isn't published on the host. To reach it, temporarily add `ports: ["9002:9000"]` to `authentik-server` and set `AUTH_PROXY_TARGET=http://localhost:9002`.

### Frontend notes

- The theme lives in `web/src/globals.css` (copied from the design, don't edit colours elsewhere). shadcn/ui primitives in `web/src/components/ui/` are restyled to `design/tcfl.css`.
- Add shadcn components with `bunx --bun shadcn@latest add <name>`. Then check the import says `from "@/lib/utils"`, and remove shadows, `ring-[3px]` and `outline-none` so it matches the design rules in `CLAUDE.md`.
- Fonts are self-hosted from `@fontsource` (Latin subset only), with no Google Fonts request.
- Regenerate API types after changing FastAPI routes: `bun run gen:api`.
- Commit `bun.lock` and `api/uv.lock`. Docker builds use `--frozen-lockfile` and `--frozen`.

## 6.5 Tests

```bash
docker compose exec api pytest                        # unit + API tests
docker compose exec api pytest tests/ocr -k national_id
docker compose exec api python -m app.scripts.eval_ocr --dataset data/ocr-eval/   # OCR accuracy report
cd web && bun run test && bun run e2e                 # Vitest unit + Playwright e2e
```

Must-have tests: ID check-letter samples (`08-2047823Q29`, `631222666S70`), eligibility rules, permission checks (student A cannot read student B's results; assistant tools scoped to caller), upload validation.

## 6.6 Importing existing data

**Planned, not built yet** ([12](12-status-and-gaps.md)): the commands below are the design for the second release. Today only reference data and intakes load in production (`python -m app.setup`, §6.7).

| Data | Command | Format |
|------|---------|--------|
| Programmes & modules | `python -m app.scripts.import_csv modules data/modules.csv` | `programme_code,module_code,name,credits,semester` |
| Lecturers | `... import_csv lecturers data/lecturers.csv` | `staff_no,title,name,email,phone,department,office` |
| Offerings & allocations | `... import_csv offerings data/offerings.csv` | `module_code,term,class_group,lecturer_staff_no,venue,day,start,end` |
| Current students | `... import_csv students data/students.csv` | `student_no,surname,first_names,email,phone,programme_code,year` |
| Enrolments | `... import_csv enrolments data/enrolments.csv` | `student_no,module_code,term,class_group` |
| Library catalogue | `... import_csv library data/library.csv` | `isbn,title,authors,call_number,copies` |

Imports are idempotent (upsert on natural keys) and log a summary of created/updated/skipped rows.

## 6.7 Production deployment (Dokploy)

[Dokploy](https://dokploy.com) runs the stack as a **Compose** application and provides TLS and routing through its built-in Traefik. There's no reverse proxy in this repo. The first release is **applications only** (landing page, sign-up, the applicant flow, Admissions and Accounts); students and staff tools follow once their data can be imported ([12](12-status-and-gaps.md)).

1. **Server:** Ubuntu 24.04 with Dokploy installed, at least 4 GB RAM and 2 CPUs (Authentik, Postgres ×2, the API with Tesseract). The firewall allows 80/443, plus Dokploy's admin port from the staff network only. SSH is restricted to admin IPs or VPN. Keep it on TelOne/TCFL infrastructure or in a Zimbabwe data centre ([07](07-security-and-compliance.md)).
2. **DNS:** point the portal's domain (for example `portal.tcfl.ac.zw`) at the server.
3. **Environment:** on your own machine, run `python3 infra/new-env.py https://portal.tcfl.ac.zw > .env.production`. It fills [.env.production.example](../.env.production.example) with a fresh random value for every secret. Keep the file out of git and somewhere safe (a password manager): it's needed to restore backups.
4. **Create the application:** in Dokploy, **Create → Compose**, choose the git repository and branch `main`, set **Compose path** to `docker-compose.prod.yml`, and paste `.env.production` into the **Environment** tab.
5. **Routing** is in the Traefik labels in `docker-compose.prod.yml`, from `APP_HOST` and `ID_HOST`: nothing to add in Dokploy's **Domains** tab (remove any domains added there, or Traefik gets two routes for one host). The web, api and authentik-server containers join Dokploy's `dokploy-network`.

   **Cloudflare in front** (how the labels are set up): Cloudflare holds the certificate and reaches the server over plain http, so the routers use Dokploy's http entrypoint (`web`, port 80) and add `X-Forwarded-Proto: https`, which Authentik needs to issue `https://` addresses that match `OIDC_ISSUER`. In Cloudflare:
   - DNS: `APP_HOST` and `ID_HOST` as **proxied** records (orange cloud) pointing at the server.
   - SSL/TLS mode **Flexible**, and **Always Use HTTPS** on. Don't use Full: the server has no certificate.
   - Leave Rocket Loader off (it rewrites the app's scripts). WebSockets on (Authentik uses them).
   - On the server, allow port 80 only from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/): between Cloudflare and the server, traffic isn't encrypted.

   | Address | Goes to |
   |---------|---------|
   | `https://APP_HOST/` | `web` (port 80) |
   | `https://APP_HOST/api` | `api` (port 8000), `/api` stripped |
   | `https://APP_HOST/auth` | `authentik-server` (port 9000), kept (Authentik expects `/auth/`) |
   | `https://ID_HOST/` | `authentik-server`; `/` goes to the admin console `/auth/if/admin/` |

6. **Restrict Authentik's admin:** add a Traefik `ipAllowList` middleware (staff LAN/VPN ranges) for `PathPrefix(/auth/if/admin)` and `PathPrefix(/auth/api/v3/admin)`, through Dokploy's advanced Traefik settings or labels on `authentik-server`.
7. **Deploy.** The API runs migrations and creates its storage buckets every time it starts. Authentik applies the blueprints in `infra/authentik/blueprints/` (groups, the portal's OIDC client, the sign-in and sign-up flows) within a minute or two.
8. **Load the college's data** from the `api` service's terminal in Dokploy:
   ```bash
   python -m app.setup reference                     # programmes, entry rules, district codes, ZIMSEC subjects
   python -m app.setup intake --code 2027-FEB --name "2027 intake" \
       --opens 2026-10-01 --closes 2026-11-30 --classes-start 2027-02-01   # the real dates
   python -m app.setup check                         # must end with "Ready."
   ```
   Fuller district and subject lists: `python -m app.setup reference --districts districts.csv --subjects subjects.csv` (columns `code,district,province` and `code,name`).
9. **Authentik:** sign in at `/auth/if/admin/` as `akadmin` with `AUTHENTIK_BOOTSTRAP_PASSWORD`.
   - Create a named admin account for each ICT administrator (group `authentik Admins`), then deactivate `akadmin`.
   - Create a service account for the portal, and a token for it under **Directory → Tokens**. Put the token in `AUTHENTIK_API_TOKEN` and redeploy: password reset by code needs it.
   - Create the staff who'll use this release and add them to their groups: **`portal-admissions`** (Admissions officers), **`portal-accounts`** (Accounts). Their portal roles follow the groups at every sign-in.
10. **Try it** before announcing: apply as a test applicant on a phone, pay by cash, confirm the payment as Accounts, review and decide as Admissions. Then delete the test applicant in Authentik.
11. **Updates:** push to `main` and click **Deploy** (or turn on auto-deploy). Settings that only Authentik reads (for example `SIGNUP_VERIFY_PHONE`, `GOOGLE_CLIENT_ID`, `AUTHENTIK_EMAIL__HOST`) need the Authentik services restarted too, so the blueprints pick them up.

**A pitch or training site** (sample data, not real applicants):
- Environment: `python3 infra/new-env.py --demo https://tcfl.example.com > .env.production`. It sets `DEMO=true` (allows the sample data on a production server), `STUDENT_PORTAL_OPEN=true`, and an Authentik admin token made on first start (`AUTHENTIK_BOOTSTRAP_TOKEN`, also used as `AUTHENTIK_API_TOKEN`).
- Hosts: `new-env.py --demo https://tcfl.example.com id.example.com` sets `APP_HOST` and `ID_HOST`; the labels route both (step 5). The admin console is at `https://id.example.com/` (it goes to `/auth/if/admin/`). The app keeps using `/auth` on its own host, which the portal's sign-in screens need.
- After deploying, in the `api` terminal: `python -m app.seed`, then `python -m app.authentik_dev` (every persona's password is `tcfl-dev-2027`; [11-test-personas.md](11-test-personas.md)). Run both again to reset the site after a demo.
- The one-click sign-in page (`/login/dev`) stays off: it's never on in production.

**Opening the student portal later:** import students, staff and modules (not built yet, [12](12-status-and-gaps.md)), set `STUDENT_PORTAL_OPEN=true`, and add staff to `portal-lecturers`, `portal-librarians` and `portal-student-affairs`.

`VITE_*` variables (if any are added) are baked in at **build** time, so redeploy after changing them.

## 6.8 Backups & recovery

| What | How | Frequency | Keep |
|------|-----|-----------|------|
| PostgreSQL | `pg_dump -Fc` run by a Dokploy **Schedule** (or cron) inside the `postgres` service → encrypted (age/GPG) → off-site S3 | nightly | 30 daily, 12 monthly |
| Authentik PostgreSQL (`authentik-db`) | `pg_dump -Fc`, same encryption and off-site target | nightly | 30 daily, 12 monthly |
| Authentik blueprints | Already in git (`infra/authentik/blueprints/`) | on change | git history |
| MinIO buckets | `mc mirror` to a second MinIO/S3 target | nightly | 30 days |
| `.env` / secrets | Offline encrypted copy held by ICT manager | on change | — |

Dokploy's own **Volume backups** can additionally snapshot the named volumes (`pgdata`, `s3data`, `authentik-db`, `authentik-data`) to S3. They're a complement to logical dumps, not a replacement.

**Test a restore every term:** restore into a staging Dokploy project and log in as a demo user.

## 6.9 Monitoring & operations

- Health endpoints: `GET /healthz` (process up), `GET /readyz` (DB, Redis, MinIO reachable).
- Metrics at `/metrics` (Prometheus): request latency, OCR queue length, OCR duration, LLM tokens/cost, failed jobs.
- Alerts: OCR queue > 200 for 15 min, error rate > 2 %, disk > 80 %, backup job failed.
- Logs: JSON to stdout → `docker compose logs -f api worker` (or the Logs tab in Dokploy); ship to Loki/ELK if available. **Never log** raw ID numbers, document images or chat content at info level.
- Intake-day runbook: scale workers up the day before; watch queue length; have an admissions officer on the review queue; fall back to "upload now, process later" if OCR backlog grows (applicants get an email when extraction is ready).

## 6.10 Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Uploads stuck in `processing` | Worker not running / crashed on model download | `docker compose logs worker`; `docker compose restart worker` |
| OCR very slow | CPU-only with 1 worker | Increase `-c`/scale workers; enable GPU; lower image max size |
| Many ID check-letter failures | Blurry photos, glare | Tighten quality gate; improve capture guidance |
| `401` from Claude | Missing/invalid `ANTHROPIC_API_KEY` | Fix key; or set `OCR_LLM_MODE=off`, `ASSISTANT_ENABLED=false` |
| Assistant says "I don't know" a lot | Content not indexed | `python -m app.scripts.reindex_kb`; check notes were published |
| `extension "vector" does not exist` | Wrong Postgres image | Use `pgvector/pgvector:pg16` |
| CORS errors in browser | Frontend calling `http://api:8000` directly instead of `/api` | Keep `VITE_API_URL=/api` and rebuild the web image. Only set `ALLOWED_ORIGINS` if the API is deliberately put on a separate domain. |
| Authentik error "redirect URI mismatch" | Callback URL not in the provider's list | Add the exact URL (scheme, host, port, path) to `redirect_uris` in the blueprint |
| Login loop, or `invalid issuer` in API logs | `OIDC_ISSUER` doesn't match the token's `iss` claim | Use the **public** Authentik URL with the trailing slash. In dev, set `OIDC_INTERNAL_BASE_URL` for container-to-container calls |
| API can't reach Authentik (connection refused to `localhost:5173`) | Back-channel calls must use the internal hostname | Set `OIDC_INTERNAL_BASE_URL=http://authentik-server:9000` |
| Authentik pages load without styles, or 404 under `/auth` | Prefix stripped, or `AUTHENTIK_WEB__PATH` missing | Keep strip path **off** for `/auth` and set `AUTHENTIK_WEB__PATH=/auth/` (with both slashes) |
| Tokens have issuer `http://authentik-server:9000/…` in dev | The proxy rewrote the Host header | Keep `changeOrigin: false` for `/auth` in `web/vite.config.ts` |
| New lecturer has no lecturer menu | Not in the `portal-lecturers` group, or hasn't signed in again since being added | Add them to the group in Authentik; roles re-sync at the next login or token refresh (5 min at most) |
| Blueprint changes not applied | YAML error, or the file isn't mounted | `docker compose logs authentik-worker \| grep -i blueprint`; check **System → Blueprints** in the admin UI |
| Refreshing `/modules/42` gives 404 in production | Missing SPA fallback | `web/nginx.conf` must keep `try_files $uri /index.html` |
| Users still see the old UI after a deploy | PWA service worker cache | `registerType: "autoUpdate"` refreshes on the next load; tell users to reload once |
