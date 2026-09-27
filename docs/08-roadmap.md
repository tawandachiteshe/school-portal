# 8. Roadmap

## Phase 0 — Discovery (2 weeks)

- Interview admissions, registry, 3–5 lecturers, librarian, ICT, 10+ students/applicants.
- Map the current onboarding process end-to-end (time per applicant, error types).
- Collect 100–200 consented sample documents for the OCR evaluation set.
- Confirm: entry requirements per programme, existing systems (student records, LMS, library, finance), hosting, DPO sign-off route.
- **Exit:** signed-off scope and data-protection approach.

## Phase 1 — Onboarding MVP (6 weeks)

- Authentik deployed from blueprints (groups, OIDC provider, authentication/enrollment/recovery flows); portal OIDC login with sessions and role sync; applicant sign-up and programme selection.
- Connect the Authentik LDAP/AD source for staff accounts, if the college has a directory.
- Upload + preprocessing + PaddleOCR + ID decoding + ZIMSEC parser.
- Applicant confirmation form, eligibility rules, staff review queue, ZIMSEC confirmation export.
- OCR evaluation report against the sample set.
- **Exit:** meets accuracy targets in [03 §3.6](03-ocr-and-id-pipeline.md#36-measuring-accuracy); admissions can process an applicant end-to-end.

## Phase 2 — Student portal core (6 weeks)

- Data import (programmes, modules, lecturers, students, enrolments).
- Dashboard, modules & lecturers, timetable, announcements, notes, tests, assignments (with submission), results publishing.
- Notifications (email + push; SMS for high priority).
- **Exit:** one programme's cohort uses it for a full month.

## Phase 3 — Library + AI assistant (4 weeks)

- Library info, catalogue, loans (Koha integration if applicable).
- Knowledge-base indexing, assistant with tools, feedback loop, usage dashboard.
- LLM-assisted OCR (`OCR_LLM_MODE=fallback`) if approved by DPO.
- **Exit:** ≥ 70 % 👍 on assistant answers in pilot; no access-control defects in security test.

## Phase 4 — Pilot intake & rollout

- Run the next intake (e.g. February intake) with the new onboarding for one or two programmes, old process as fallback.
- Penetration test / security review before full rollout.
- Train staff (admissions, lecturers, librarians); publish student how-to videos.
- Roll out to all programmes; retire the old process.

## Success metrics

| Metric | Baseline (measure in Phase 0) | Target |
|--------|-------------------------------|--------|
| Time from application to decision | ? days | ≤ 3 working days |
| Staff minutes per application | ? | −70 % |
| Data-entry errors found after registration | ? | −90 % |
| Applicants who applied fully online | ? | ≥ 60 % |
| Weekly active students on portal | — | ≥ 80 % of enrolled |
| Missed-deadline complaints | ? | −50 % |

## Later ideas

- Fee statements & payment (Paynow / EcoCash integration).
- Attendance via QR check-in.
- Timetable generation / clash solver.
- Official ZIMSEC verification API integration (if ZIMSEC offers one under an MoU).
- Alumni and industrial-attachment tracking.
- WhatsApp channel for the assistant and reminders.
