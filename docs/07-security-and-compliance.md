# 7. Security & Compliance

> This is technical guidance, not legal advice. Have the college's Data Protection Officer and legal team review it before go-live.

## 7.1 Legal framework (Zimbabwe)

- **Cyber and Data Protection Act [Chapter 12:07]** — lawful, fair, purpose-limited processing; data subject rights; security safeguards; breach notification. POTRAZ is the Data Protection Authority.
- **SI 155 of 2024** (Licensing of Data Controllers and Appointment of DPOs) — data controllers need a **POTRAZ licence** (Form DP1, renewed every 12 months) and a registered **DPO** (Form DP2). The application declares categories of sensitive data, safeguards, and whether data is stored outside Zimbabwe. Processing without a licence is an offence.

Sources: [MISA Zimbabwe](https://zimbabwe.misa.org/2025/03/14/navigating-the-data-protection-act-requirements-ensuring-compliance-for-zimbabwean-data-controllers/), [DLA Piper Africa](https://www.dlapiperafrica.com/en/zimbabwe/insights/2024/A-Quick-Start-Guide-to-Zimbabwes-Data-Protection-Regulations), [POTRAZ draft regulations](https://www.potraz.gov.zw/wp-content/uploads/2022/11/Draft-Cyber-and-Data-Protection-Regulations-.pdf).

### Compliance checklist

- [ ] Confirm the college is covered by its own (or its parent organisation's) data controller licence; update the declaration to include the portal's processing (ID numbers, academic records, images, chat logs).
- [ ] DPO reviews this design; Data Protection Impact Assessment (DPIA) completed for OCR + AI features.
- [ ] Privacy notice shown at sign-up, in plain English (and Shona/Ndebele), explaining: what's collected, why, who sees it, retention, third-party processors (Anthropic, SMS/email providers), rights and contact.
- [ ] Explicit consent checkbox for document processing; separate opt-in for AI features where images/data are sent to an external processor.
- [ ] Data Processing Agreement with each processor; record cross-border transfers (Claude API is outside Zimbabwe — declare it, or run `OCR_LLM_MODE=off`).
- [ ] Data subject request workflow (access, correction, deletion) — admin tool + 30-day SLA.
- [ ] Breach response plan with POTRAZ notification steps and contacts.

## 7.2 Data classification

| Class | Examples | Controls |
|-------|----------|----------|
| **Sensitive** | ID number, ID/certificate images, DOB, results | Encrypted at rest; access by role + audit log; masked in lists (`63-20•••••Q 29`) |
| **Personal** | Name, email, phone, enrolments, chat transcripts | Role-based access; retention limits |
| **Internal** | Notes, assessments, library catalogue | Enrolled users only |
| **Public** | Programme info, general announcements | — |

## 7.3 Retention

| Data | Retention |
|------|-----------|
| Documents of **rejected / withdrawn** applicants | 180 days after decision, then deleted (images + extracted data) |
| Documents of **accepted** students | Duration of study + period required by college policy / ZIMSEC / funders; then archive or delete |
| Raw OCR text | Deleted once the applicant confirms and staff approve (keep only structured fields) |
| Chat transcripts | 90 days (user can delete anytime) |
| Audit logs | 2 years |

A nightly `beat` job enforces retention and records what it deleted.

## 7.4 Application security

- **Auth:** delegated to self-hosted **Authentik** ([10](10-authentication.md)). The portal stores no passwords or MFA secrets.
  - **MFA:** TOTP or WebAuthn/passkeys are **mandatory for staff groups**; brute-force protection comes from Authentik's reputation policy.
  - **Sessions:** the portal uses the backend-for-frontend pattern. Only an opaque httpOnly, Secure, SameSite=Lax cookie reaches the browser. Access tokens last 5 minutes; refresh tokens are stored encrypted server-side.
  - **Revocation:** disabling a user in Authentik revokes their portal sessions (webhook plus failed refresh).
  - **Hardening:** see the checklist in [10 §10.9](10-authentication.md#109-hardening-checklist).
- **Authorisation:** every API endpoint declares required role + ownership check; tests cover horizontal access (student A ≠ student B).
- **Uploads:** size/type allow-list, magic-byte check, image re-encode (drops embedded payloads), ClamAV scan, private bucket, short-lived presigned URLs (5 min), no public object ACLs.
- **Storage encryption:** Postgres volume on encrypted disk (LUKS); MinIO server-side encryption (SSE-S3/KMS); column-level encryption for `national_id` (pgcrypto or app-level AES-GCM with key outside DB), plus a keyed hash (HMAC) column for duplicate lookup.
- **Transport:** TLS 1.2+ everywhere; HSTS; internal services not exposed publicly.
- **Web:** CSP, CSRF protection for cookie-auth routes, output encoding (Markdown rendered with sanitiser), dependency scanning (Dependabot / `pip-audit` / `bun audit`) in CI.
- **Audit log:** every view of sensitive documents and every approve/reject/edit recorded with actor, time, IP.
- **Admin hygiene:** least-privilege roles; staff accounts disabled on exit (HR checklist); quarterly access review.

## 7.5 AI-specific risks

| Risk | Mitigation |
|------|------------|
| OCR/LLM misreads a grade → wrong admission decision | Applicant confirmation + staff review + ZIMSEC confirmation; LLM never decides eligibility (rules engine does) |
| Assistant reveals another student's data | Retrieval filtered by audience; tools scoped to caller; model never receives other users' records |
| Prompt injection via uploaded notes | Context treated as data in system prompt; read-only tools |
| Academic dishonesty | Tutor-mode system prompt; lecturers can view aggregate usage; clear policy in student handbook |
| Personal data sent offshore | Consent + DPA + licence declaration, or `OCR_LLM_MODE=off` / `ASSISTANT_ENABLED=false` |
| Bias / unequal accuracy on poor-quality photos | Measure accuracy by capture type; improve capture UX; human review for low confidence |
