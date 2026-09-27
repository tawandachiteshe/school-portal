# 10. Authentication with Authentik

All sign-in, sign-up, MFA and password recovery is handled by **[Authentik](https://goauthentik.io/)**, a self-hosted identity provider. The portal holds no passwords or MFA secrets.

## 10.1 Why Authentik

| Need | How Authentik covers it |
|------|-------------------------|
| Applicants sign themselves up | **Enrollment flow**: email → password → email verification (and optional phone verification) |
| Staff sign in with their existing college account | **LDAP / Active Directory source**, or federate to Microsoft Entra / Google Workspace if the college uses them |
| Strong MFA for staff, optional for students | **Authenticator validation stage** with a policy that requires TOTP or WebAuthn/passkeys for staff groups |
| SMS codes via a local Zimbabwean provider | **SMS authenticator stage, generic provider**: Authentik POSTs `{From, To, Body}` to any HTTP API. It also supports "verify only" mode for proving phone ownership at sign-up. |
| Password reset, account lockout, brute-force protection | Built-in recovery flow, reputation policy |
| Data stays on campus | Self-hosted on the same server. No external identity service. |
| Config as code | **Blueprints**: YAML files mounted into `/blueprints` are applied automatically, so the whole Authentik setup lives in this repo |
| One login for other college systems later | The same Authentik can front Moodle, Koha and Wi-Fi (OIDC, SAML, LDAP, RADIUS) |

Sources: [Authentik Docker Compose install](https://docs.goauthentik.io/install-config/install/docker-compose/), [OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/), [Blueprints](https://docs.goauthentik.io/customize/blueprints/), [SMS authenticator stage](https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_sms/).

## 10.2 Architecture: our own sign-in screens + backend-for-frontend (BFF)

Two decisions, from `CLAUDE.md` and `docs/design-handoff.md`:

1. **The React app renders its own sign-in, sign-up, SMS-verify and recovery screens** (`design/SignIn`, `Register`, `VerifyPhone`, `ForgotPassword`, `StaffSignIn`). It gets them by driving Authentik's **flow executor API** (`/auth/api/v3/flows/executor/<slug>/`). Each response is a *challenge* (identification, password, prompt, SMS code, redirect…), and the app maps each challenge component to a screen. Users never see Authentik's own UI.
2. **The session is still a BFF session.** Once a flow finishes, FastAPI runs the standard OIDC code flow. Authentik already has a session, so this completes instantly, and the browser only ever holds an opaque portal cookie.

Authentik is served **under `/auth/` on the portal origin** (`AUTHENTIK_WEB__PATH=/auth/`). This lets the SPA call the flow executor with Authentik's own session and CSRF cookies, with no CORS and no third-party cookies.

```
 Browser (React SPA)                    FastAPI (confidential client)        Authentik (/auth/)
 ───────────────────                    ─────────────────────────────        ──────────────────
 /login: GET /auth/api/v3/flows/executor/tcfl-authentication/ ─────────────▶ challenge: ak-stage-identification
 render SignIn screen; POST username ──────────────────────────────────────▶ challenge: ak-stage-password
 POST password ────────────────────────────────────────────────────────────▶ (MFA challenge for staff)
                                                                        ◀─── xak-flow-redirect  (Authentik session set)
 window.location = /api/auth/login?next=/ ─▶ state + nonce + PKCE → 302 /auth/application/o/authorize/
                                                                        ───▶ session exists → 302 immediately
 GET /api/auth/callback?code=… ───────────▶ exchange code (+ secret + PKCE) at the internal URL
                                            validate id_token (iss, aud, nonce, JWKS)
                                            upsert users/people, sync roles from `groups`
                                            create web_sessions row (refresh token encrypted)
           ◀──────────────────────────────── Set-Cookie: portal_session=…; HttpOnly; Secure; SameSite=Lax → 302 /
 fetch /api/me (cookie) ──────────────────▶ session → user, roles (Redis-cached); refresh as needed;
                                            refresh rejected (user disabled) → session revoked → 401
```

**Why this combination:**
- **Design control:** the sign-in screens match the portal design exactly, with no themed-template compromise.
- **Token safety:** access and refresh tokens never reach browser JavaScript, and the API can revoke a session instantly. This is the BFF pattern the IETF "OAuth 2.0 for Browser-Based Apps" guidance recommends.
- **Authentik keeps the security logic:** password policy, reputation and lockout, MFA, SMS, and enrollment all stay in Authentik. React only renders the challenges.

**Flow-executor client notes (`web/src/lib/authentik-flow.ts`):**
- **Unknown challenges:** map `component` → screen. Anything unmapped falls back to "Continue in a browser" by redirecting to `/auth/if/flow/<slug>/`, so a new stage type added in Authentik never locks users out.
- **CSRF:** send `X-authentik-CSRF` (read from the `authentik_csrf` cookie) on POSTs. Use `credentials: "same-origin"`. Authentik only checks it for a session that is already signed in, and its cookie has `Path=/auth/`, so the SPA at `/login` can't read it. So the sign-in and sign-up screens first ask `GET /auth/api/v3/core/users/me/`. If someone is still signed in to Authentik (the portal session ended first, or someone else used the browser), they show "You're signed in as … · Continue as … · Not you? Sign out" instead of the form. Sign out ends the portal session and then `GET`s the `default-invalidation-flow` executor, which runs its logout stage without a CSRF token.
- **Stages answered for the user:** `ak-stage-user-login` is answered with `remember_me` (from "This is a shared computer" on StaffSignIn), so there's no extra screen. The SMS stage is sent the number typed on the sign-up form, and its code is sent as a number.
- **Mobile numbers as usernames:** SignIn turns `077 318 4521`, `0773184521` or `+263 77 318 4521` into `263773184521` before sending it, the same way sign-up stores it.
- **Usernames:** applicants' usernames are their E.164 number without `+` (e.g. `263773184521`), and students' are their student number. The identification stage matches username, email or UPN (design-handoff.md).

## 10.3 Authentik objects

Everything below is created by the blueprint in `infra/authentik/blueprints/tcfl-portal.yaml` (§10.8).

**Application:** `TCFL Portal` (slug `tcfl-portal`)

**OAuth2/OpenID provider:** `tcfl-portal`

| Setting | Value |
|---------|-------|
| Client type | Confidential |
| Redirect URIs | `https://portal.tcfl.ac.zw/api/auth/callback` (prod), `http://localhost:5173/api/auth/callback` (dev) |
| Scopes | `openid`, `email`, `profile` (includes `groups`), `offline_access` |
| Subject mode | Based on the user's **UUID**. It's stable and doesn't change if the email changes. |
| Access token validity | 5 minutes |
| Refresh token validity | 8 hours (staff), up to 14 days (students, via "remember me") |
| Signing key | The default self-signed certificate (RS256) |

- **Issuer:** `https://portal.tcfl.ac.zw/auth/application/o/tcfl-portal/` (dev: `http://localhost:5173/auth/application/o/tcfl-portal/`)
- **Discovery:** issuer + `.well-known/openid-configuration`

**Groups → portal roles:**

| Authentik group | Portal role | Who manages membership |
|-----------------|-------------|------------------------|
| `portal-applicants` | `applicant` | Added automatically by the enrollment flow |
| `portal-students` | `student` | The **portal**, via the Authentik API, when an application is accepted or students are imported |
| `portal-lecturers` | `lecturer` | ICT/HR in Authentik (or synced from an AD group) |
| `portal-admissions` | `admissions` | ICT in Authentik |
| `portal-registry` | `registry` | ICT in Authentik |
| `portal-librarians` | `librarian` | ICT in Authentik |
| `portal-accounts` | `accounts` | ICT in Authentik. Confirms bank and cash application fees |
| `portal-admins` | `admin` | ICT in Authentik (small group, MFA required) |
| `portal-staff` | (none) | Parent group of all staff groups, used by the MFA policy |

**Flows:**

| Flow | Purpose |
|------|---------|
| `tcfl-authentication` | Identification (username or email) and password on one screen → MFA validation for anyone with a device → login (8 h; 14 days with "remember me") |
| `tcfl-enrollment` | Applicant sign-up: name, mobile number (becomes the username), email (optional), password twice (10+ characters, zxcvbn score ≥ 2) → write the user into `portal-applicants` → **phone check by SMS code** (verify-only; only when `SIGNUP_VERIFY_PHONE` is set) → login |
| `tcfl-source-authentication`, `tcfl-source-enrollment` | Google sign-in and sign-up (only with `GOOGLE_CLIENT_ID`) |
| Password reset | Done by the portal, not a flow (below) |
| `tcfl-invitation` | For imported students and staff: set a password from an invitation link |

Both flows are in `infra/authentik/blueprints/tcfl-flows.yaml`.

**Phone check on sign-up (`SIGNUP_VERIFY_PHONE`).** The SMS stage is bound to `tcfl-enrollment` with an expression policy, `tcfl-verify-phone-on`, which is true only when `SIGNUP_VERIFY_PHONE` is set in Authentik's environment. It is **off until an SMS provider is set up**: applicants go from the form straight into their application, and their number isn't checked. To turn it on, set `SIGNUP_VERIFY_PHONE=1` and restart the Authentik worker so the blueprint is applied again. The stage needs the user to exist, so the account is written before the number is checked. An abandoned sign-up leaves an applicant account whose number isn't verified.

**Email, the same way as SMS.** Sign-up asks for an optional email address. People can sign in with it (the identification stage matches username or email), and the password reset page accepts it too.
- **Checking the address at sign-up:** the `tcfl-verify-email` stage (Authentik's email authenticator) emails a 6-digit code, and the portal shows the same code screen as for SMS ("Check your email"). Its binding has the policy `tcfl-verify-email-on`, which is true only when `AUTHENTIK_EMAIL__HOST` is set and the person gave an email. **Without SMTP nothing is sent and the person goes straight through**, with the address kept unchecked. After setting it, restart the Authentik worker so the blueprint is applied again.
- **Password reset:** the code goes by SMS to the account's phone and by email to its address, whichever it has (a Google sign-up may only have email). The portal sends email itself (`app/mail.py`, `SMTP_*`). Without `SMTP_HOST` nothing is emailed; development logs the text instead.
- Codes are sent to Authentik as text, not numbers: a code can start with 0.

**Google.** "Continue with Google" shows on sign-in (below the form) and sign-up (above it) when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. The API reads `GOOGLE_CLIENT_ID` for `GET /api/auth/options` (`{google}`), and the blueprint only creates the Google objects when it is set.
- The button links to `/auth/source/oauth/login/google/?next=/api/auth/login?next=…`. Authentik sends the browser to Google, then runs a source flow on its own page, then follows `next` into the portal's usual OIDC sign-in.
- `tcfl-source-authentication` signs in a Google account already linked, or whose email matches an existing account (`user_matching_mode: email_link`; Google verifies emails).
- `tcfl-source-enrollment` makes anyone else an applicant (`portal-applicants`), with their name and email from Google and no mobile number yet.
- Both use their own login stage, `tcfl-login-google`, which asks nothing, because these flows run on Authentik's page.
- In the Google Cloud console, create an OAuth client of type *Web application* with the redirect URI `<portal origin>/auth/source/oauth/callback/google/`.
- Turning Google off later: clear the variables and delete the `google` source in Authentik (the blueprint skips its entries but doesn't remove them).

**SMS.** Authentik's *generic* SMS provider posts `{From, To, Body}` with a bearer token (`SMS_WEBHOOK_SECRET`) to the portal at `POST /api/internal/sms` (`PORTAL_SMS_WEBHOOK_URL`). This covers the sign-up code. The text joins `sms_outbox`, which the SMS worker sends once `SMS_PROVIDER` is set. In development there is no provider, and the API logs `SMS to +263…: <code>` instead.

**Password reset by SMS code (design/ForgotPassword).** Students and applicants have phones, not reliable email, so the portal does this itself:
- `POST /api/auth/reset/start {identifier}` takes a student number, mobile number or email. It sends a 6-digit code by SMS and/or email (valid 10 minutes, at most 3 codes an hour) and always answers `{minutes: 10}`, so the page can't be used to find accounts.
- `POST /api/auth/reset/finish {identifier, code, password}` checks the code (keyed hash, 5 tries, used once), then sets the password with the Authentik admin API (`AUTHENTIK_API_URL`, `AUTHENTIK_API_TOKEN`). Authentik's password policy errors are shown as they come.
- Staff reset through ICT Services or their TCFL email, as the design says.

**Development accounts.** `uv run python -m app.authentik_dev` (in `api/`) creates or updates an Authentik user for every seeded portal user. It sets their groups and phone and the password `tcfl-dev-2027`, and links them. Rerun it after `app.seed`, or to put back passwords changed while testing. `/login/dev` still signs in as a sample account without Authentik while `DEV_LOGIN` is on.

## 10.4 Two layers of authorisation

1. **Coarse roles come from Authentik groups.** The `groups` claim is read at every login and on every token refresh. `user_roles` is a **mirror** of it, used for fast queries and SQL functions such as `kb_visible_documents`.
2. **Fine-grained access lives in the portal DB.** Examples: which offerings a lecturer teaches (`offering_lecturers`), whose results a student can see (their own `students` row), and which applications an officer is assigned.

Authentik never needs to know about modules or classes.

The **portal writes back** to Authentik in only three cases, using a service-account API token with narrowly scoped permissions:

| Portal event | Authentik API call |
|--------------|--------------------|
| Application accepted | Add the user to `portal-students` and remove them from `portal-applicants` |
| Student imported from CSV (no account yet) | Create the user, add them to `portal-students`, send an invitation email |
| Student withdrawn or graduated | Remove them from `portal-students` (the account can stay for alumni and library use) |

## 10.5 Account lifecycle

| Situation | What happens |
|-----------|--------------|
| **First login** | The API upserts `users` by `idp_subject` and creates or links a `people` row from the name and email claims. Applicants complete the rest of their details in the onboarding wizard. |
| **Existing student, first login** | The import pre-created the Authentik user (with `idp_user_pk` stored) and the portal `users`/`people`/`students` rows. The first login matches on `idp_subject`. |
| **Email or name changed in Authentik** | Cached copies in `users` are refreshed on the next login or token refresh |
| **Account disabled in Authentik** (staff leaves, suspension) | The next token refresh is rejected, so the portal session is revoked. For instant effect, an Authentik **notification rule** (event `model_updated` on users) calls the portal webhook `POST /api/internal/idp-events`, which revokes all of that user's sessions. |
| **Logout** | The portal deletes the session and redirects to Authentik's `end-session` endpoint (RP-initiated logout), so the single sign-on session also ends |
| **Data-subject deletion request** | The portal anonymises its rows. The DPO checklist includes deleting the Authentik user. |

## 10.6 API implementation sketch

Uses **Authlib** (`authlib`) for OIDC, with sessions stored in Postgres (`web_sessions`) and cached in Redis.

```python
# api/app/auth/oidc.py
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from app.config import settings
from app.auth import sessions, sync

oauth = OAuth()
oauth.register(
    name="authentik",
    server_metadata_url=f"{settings.oidc_issuer}.well-known/openid-configuration",
    client_id=settings.oidc_client_id,
    client_secret=settings.oidc_client_secret,
    client_kwargs={"scope": "openid email profile offline_access", "code_challenge_method": "S256"},
)

router = APIRouter(prefix="/auth")

@router.get("/login")
async def login(request: Request, next: str = "/dashboard"):
    request.session["next"] = next if next.startswith("/") else "/dashboard"   # no open redirects
    return await oauth.authentik.authorize_redirect(request, settings.oidc_redirect_uri)

@router.get("/signup")
async def signup(request: Request):
    # Same flow; Authentik's login page links to the enrollment flow.
    return await login(request, next="/apply")

@router.get("/callback")
async def callback(request: Request):
    token = await oauth.authentik.authorize_access_token(request)   # checks state, nonce, id_token signature
    claims = token["userinfo"]
    user = await sync.upsert_user_from_claims(claims)             # users/people + user_roles from claims["groups"]
    session_id = await sessions.create(user.id, token, sid=claims.get("sid"),
                                       ip=request.client.host, ua=request.headers.get("user-agent"))
    resp = RedirectResponse(request.session.pop("next", "/dashboard"))
    resp.set_cookie("portal_session", session_id, httponly=True, secure=settings.is_prod,
                    samesite="lax", max_age=settings.session_max_age, path="/")
    return resp

@router.post("/logout")
async def logout(request: Request):
    id_token = await sessions.revoke(request.cookies.get("portal_session"))
    resp = RedirectResponse(
        f"{settings.oidc_issuer}end-session/?id_token_hint={id_token}"
        f"&post_logout_redirect_uri={settings.app_url}/", status_code=303)
    resp.delete_cookie("portal_session", path="/")
    return resp
```

```python
# api/app/auth/deps.py: used by every protected endpoint
async def current_user(request: Request) -> CurrentUser:
    sid = request.cookies.get("portal_session")
    user = await sessions.resolve(sid)          # Redis → Postgres; refreshes tokens when needed
    if user is None:
        raise HTTPException(401)
    return user

def require_role(*roles: Role):
    async def dep(user: CurrentUser = Depends(current_user)):
        if not user.roles & set(roles):
            raise HTTPException(403)
        return user
    return dep
```

Notes:
- **CSRF:** the session cookie is `SameSite=Lax`, and state-changing endpoints additionally require an `X-CSRF-Token` header. It's a double-submit token issued by `GET /api/auth/csrf`, and the React `lib/api.ts` wrapper sends it automatically.
- **Internal vs. public URL in development:**
  - The browser reaches Authentik at `http://localhost:5173/auth/` (dev) or `https://portal.tcfl.ac.zw/auth/` (prod), but the API container reaches it at `http://authentik-server:9000/auth/`.
  - Keep `OIDC_ISSUER` as the public URL, because it must match the token's `iss` claim.
  - Set `OIDC_INTERNAL_BASE_URL` so the API's back-channel calls (discovery, token, JWKS) are sent to the internal host.
- **React side:**
  - `useAuth()` calls `GET /api/me`. A `401` means `window.location = "/api/auth/login?next=" + location.pathname`.
  - "Apply now" links to `/api/auth/signup`.

## 10.7 Configuration

`.env` additions (API):

```dotenv
OIDC_ISSUER=http://localhost:5173/auth/application/o/tcfl-portal/   # prod: https://portal.tcfl.ac.zw/auth/application/o/tcfl-portal/
OIDC_INTERNAL_BASE_URL=http://authentik-server:9000              # dev and prod: back-channel calls stay internal
OIDC_CLIENT_ID=tcfl-portal
OIDC_CLIENT_SECRET=change-me                                     # must match the blueprint
OIDC_REDIRECT_URI=http://localhost:5173/api/auth/callback
SESSION_MAX_AGE=1209600                                          # 14 days, capped by the refresh token
SESSION_ENCRYPTION_KEY=change-me-32-bytes-base64                 # encrypts stored refresh tokens
AUTHENTIK_API_URL=http://authentik-server:9000/auth/api/v3/
AUTHENTIK_API_TOKEN=change-me                                    # service account: user + group management only
IDP_WEBHOOK_SECRET=change-me                                     # verifies /api/internal/idp-events calls
```

`.env` additions (Authentik):

```dotenv
AUTHENTIK_SECRET_KEY=change-me                  # openssl rand -base64 60
AUTHENTIK_PG_PASS=change-me                     # openssl rand -base64 36
AUTHENTIK_TAG=2026.8.3
AUTHENTIK_WEB__PATH=/auth/                     # set in docker-compose*.yml
AUTHENTIK_EMAIL__HOST=smtp.example.co.zw
AUTHENTIK_EMAIL__PORT=587
AUTHENTIK_EMAIL__USERNAME=
AUTHENTIK_EMAIL__PASSWORD=
AUTHENTIK_EMAIL__USE_TLS=true
AUTHENTIK_EMAIL__FROM=TCFL Portal <no-reply@tcfl.ac.zw>
AUTHENTIK_BOOTSTRAP_PASSWORD=change-me          # first akadmin password (dev/CI only)
AUTHENTIK_BOOTSTRAP_TOKEN=change-me             # first API token (dev/CI only)
```

## 10.8 Blueprint (config as code)

`infra/authentik/blueprints/tcfl-portal.yaml` is mounted into `/blueprints/custom/`. Authentik applies it on start, re-applies it when the file changes, and reconciles it hourly. An excerpt:

```yaml
version: 1
metadata:
  name: TCFL Portal
entries:
  - model: authentik_core.group
    id: staff
    identifiers: { name: portal-staff }
  - model: authentik_core.group
    identifiers: { name: portal-lecturers }
    attrs: { parent: !KeyOf staff }
  - model: authentik_core.group
    identifiers: { name: portal-admins }
    attrs: { parent: !KeyOf staff }
  - model: authentik_core.group
    identifiers: { name: portal-students }
  - model: authentik_core.group
    identifiers: { name: portal-applicants }
  # … portal-admissions, portal-registry, portal-librarians (parent: staff)

  - model: authentik_providers_oauth2.oauth2provider
    id: provider
    identifiers: { name: tcfl-portal }
    attrs:
      client_type: confidential
      client_id: tcfl-portal
      client_secret: !Env OIDC_CLIENT_SECRET
      authorization_flow: !Find [authentik_flows.flow, [slug, default-provider-authorization-implicit-consent]]
      invalidation_flow: !Find [authentik_flows.flow, [slug, default-provider-invalidation-flow]]
      redirect_uris:
        - { matching_mode: strict, url: "http://localhost:5173/api/auth/callback" }
        - { matching_mode: strict, url: "https://portal.tcfl.ac.zw/api/auth/callback" }
      sub_mode: user_uuid
      access_token_validity: minutes=5
      refresh_token_validity: days=14
      property_mappings:
        - !Find [authentik_providers_oauth2.scopemapping, [scope_name, openid]]
        - !Find [authentik_providers_oauth2.scopemapping, [scope_name, email]]
        - !Find [authentik_providers_oauth2.scopemapping, [scope_name, profile]]
        - !Find [authentik_providers_oauth2.scopemapping, [scope_name, offline_access]]

  - model: authentik_core.application
    identifiers: { slug: tcfl-portal }
    attrs:
      name: TCFL Portal
      provider: !KeyOf provider
      meta_launch_url: https://portal.tcfl.ac.zw/
```

The flows (`tcfl-authentication`, `tcfl-enrollment`, `tcfl-recovery`, `tcfl-invitation`) live in separate blueprint files next to this one. Build them once in the Authentik admin UI, then export them (**Flows → Export**) into the repo, so they're versioned and reproducible.

> Check the model and field names against the Authentik version you run (blueprint schema: `/blueprints/schema.json` in the container). They can change between releases.

## 10.9 Hardening checklist

- [ ] Authentik served under `/auth/` on the portal domain through Dokploy's Traefik with TLS. The admin interface (`/auth/if/admin/`, `/auth/api/v3/admin/`) is reachable only from the staff network or VPN (Traefik `ipAllowList`, see [06 §6.7](06-running-the-system.md#67-production-deployment-dokploy)).
- [ ] `akadmin` renamed or disabled after the named admin accounts are created. Admins must use MFA.
- [ ] MFA required for `portal-staff` members, with passkeys (WebAuthn) encouraged for everyone.
- [ ] Reputation policy (brute-force lockout) and a password policy on the enrollment and recovery flows.
- [ ] The service-account token for the portal has **only** user-create and group-membership permissions, and is rotated yearly.
- [ ] Authentik's Postgres is included in the backup job ([06 §6.8](06-running-the-system.md#68-backups--recovery)).
- [ ] Authentik event logs are retained for 90 days, then forwarded or purged per the retention policy.
- [ ] The Authentik worker does **not** mount the Docker socket. It's only needed for managed outposts, which this setup doesn't use.

## 10.10 Desktop-to-phone handoff

This lets an applicant who started on a computer continue the document-scanning steps on their phone without signing in again ([05 §5.2](05-portal-features.md#continue-on-your-phone)). It's a **narrow, portal-issued capability**, not a second Authentik login.

```
Desktop (signed in)                         API                                   Phone
POST /api/onboarding/handoffs ───────────▶ create device_handoffs row
                                            token = 32 random bytes (only its hash is stored)
                                            match_code = 4 chars
          ◀──── {qr_url, short_code, match_code, expires_at}
show QR + match code; open SSE /handoffs/{id}/events
                                                                         scan QR → GET /h/{token}
                                            verify hash, unexpired, unclaimed
                                            mark claimed (single use), set claimed_ua/ip
                                            Set-Cookie: portal_handoff=…  (HttpOnly, Secure,
                                              SameSite=Lax, Path=/api/onboarding, 60 min)
          ◀── SSE "phone_connected"                               ──▶ redirect to /apply/{step}
                                                                         (phone shows the same match code)
                                                                   uploads documents
          ◀── SSE "document_uploaded" / "extracted"  (desktop view updates live)
[Disconnect] DELETE /handoffs/{id} ───────▶ revoked_at = now() → phone gets 401 → "Continue on your computer"
```

**What the handoff session can do:** it's enforced by a separate FastAPI dependency, `current_handoff`, which is **not** accepted by `current_user`.
- Allowed: upload documents to *this* `application_id`, read extraction results for documents uploaded in this handoff, and confirm or edit those fields.
- Not allowed: the dashboard, other applications, account or profile settings, submitting the application, or accepting a decision. Submission always happens in the signed-in session.

**Protections:**
- The QR token is single-use and must be claimed within 15 minutes. Only its SHA-256 hash is stored, so a leaked database can't be used to claim links.
- The short code (8 characters, no ambiguous letters) is an alternative to the QR. It's rate-limited to 5 attempts per IP per 15 minutes.
- The match code shown on both screens helps the applicant spot a hijacked or "shoulder-surfed" QR.
- The desktop sees the claiming device (browser and OS) and can revoke it instantly.
- "Send to my phone" uses the applicant's **verified** phone or email from Authentik only, never a number typed in at that moment.
- Every create, claim, revoke and expiry is written to `audit_log`.

Table: `device_handoffs` in [database/schema.sql](database/schema.sql).
