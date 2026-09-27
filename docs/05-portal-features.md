# 5. Portal Features

## 5.1 Roles

| Role | Can do |
|------|--------|
| **Applicant** | Create account, upload documents, confirm extracted data, track application, chat (applicant scope) |
| **Student** | Dashboard, results, modules & lecturers, timetable, tests, assignments (submit), notes, library, announcements, assistant |
| **Lecturer** | Manage own module offerings: post notes, create tests/assignments, mark submissions, enter coursework marks, post class announcements |
| **Admissions officer** | Review queue, approve/reject applications, ZIMSEC confirmation batches, reports |
| **Registry / exams officer** | Publish results, manage terms, programmes, modules, enrolments |
| **Librarian** | Catalogue, loans, library info pages, library announcements |
| **Admin** | Users & roles, reference data (districts, ZIMSEC subjects, entry rules), integrations, audit log, assistant settings |

Permissions are checked in the API (not only hidden in the UI). Lecturers only see offerings they're assigned to.

## 5.2 Onboarding (applicants)

1. **Sign up** through the Authentik enrollment flow: email and password, a verification email, and optional phone verification by SMS. Passkeys can be added later ([10 §10.3](10-authentication.md#103-authentik-objects)).
2. **Choose programme** and intake; entry requirements shown up front.
3. **Scan national ID** → decoded number, check-letter status, name, DOB pre-filled.
4. **Scan ZIMSEC result slips / certificates** (one or more sittings, O and/or A-Level) → subjects and grades table pre-filled.
5. **Confirm** each field (low-confidence ones highlighted, image crop shown alongside).
6. **Instant eligibility check** with explanation ("You have 4 passes at C or better; 5 are required").
7. **Submit** → status tracker: *Submitted → In review → More info needed / Accepted / Not accepted*.
8. On acceptance: student number issued, account upgraded to **Student**, enrolled into first-semester module offerings, welcome announcement and orientation checklist.

### Continue on your phone

Applicants often start on a laptop or a lab computer, but a phone camera is far better for scanning documents. At any point in the wizard, especially on the ID and ZIMSEC steps, the applicant can choose **Continue on your phone**:

1. The desktop shows a **QR code**, a short link (`portal.tcfl.ac.zw/h/K7Q2-9MXD`), and a **"Send link to my phone"** option by SMS to their verified number, or by email.
2. The phone opens the link and goes **straight to the same step**, with no second login (see [10 §10.10](10-authentication.md#1010-desktop-to-phone-handoff)). Both screens show the same **4-character match code**, so the applicant can confirm they're pairing their own phone.
3. The desktop switches to a **waiting view** ("Phone connected: Android · Chrome") and updates live as each document is uploaded: "National ID received ✓, reading…". Extracted fields appear on **both** screens.
4. The applicant can finish on either device. The desktop can **disconnect the phone** at any time, and the link expires on its own.

Rules:
- A link can be claimed **once**, within **15 minutes**.
- The phone's access lasts **60 minutes** and covers **only this application's onboarding steps**. It can't see the dashboard, other documents, or account settings.
- Every handoff is recorded in the audit log.

Staff console: queue with risk score, filters (programme, status, flags), side-by-side review, bulk export for ZIMSEC confirmation, intake statistics.

## 5.3 Student dashboard

Single mobile-first page, cards in this order:

1. **Today** — classes today with venue and lecturer.
2. **Due soon** — tests & assignments in the next 7 days, sorted by date, with countdown and "submitted ✓" state.
3. **Announcements** — unread first; pinned at top; audience: all / programme / year / class.
4. **New notes** — latest uploads from my modules.
5. **Library** — books on loan, due dates, fines.
6. **Latest results** — when published.
7. **Ask TCFL** — assistant shortcut.

## 5.4 Modules & lecturers

- **My modules** list for the current term: code, name, credits, class group, schedule, venue.
- **Module page:** lecturer(s) with photo, title, department, office, email, phone/WhatsApp (if published), consultation hours; tabs for **Notes**, **Assessments**, **Announcements**, **Coursework marks**.
- **Timetable** view (week grid) with `.ics` export / calendar subscription link.

## 5.5 Results

- Per term: module, coursework mark, exam mark, final mark, grade, credits; term GPA/average and cumulative.
- Results visible only after registry **publishes** them (`published_at`); optional fee-clearance gate.
- Downloadable **provisional statement of results** PDF with QR code linking to a verification URL (`/verify/<token>`) that shows the same data for employers — a TCFL equivalent of the ZIMSEC confirmation idea.
- Onboarding (ZIMSEC) results are shown under **Entry qualifications** with their verification status.

## 5.6 Upcoming tests

- Created by lecturer: title, module, date/time, duration, venue, topics covered, allowed materials, weight.
- Reminders: 7 days, 1 day, 2 hours before (web push/email/SMS per student preference).
- Clash detection when a lecturer schedules a test overlapping another test for the same class group.

## 5.7 Assignments

- Title, brief (Markdown + attachments), open date, due date, weight, submission mode (online / physical), late policy.
- Online submission to MinIO with receipt (timestamp + SHA-256); resubmission until due date if allowed.
- Lecturer marking view: download all, enter mark + feedback, release marks to class.
- Reminders like tests; overdue badge.

## 5.8 Notes

- Lecturers upload PDF, DOCX, PPTX, video links; organise by week/topic.
- Students view in-browser and download; available offline in the PWA once opened.
- Notes are indexed for the assistant (only for students enrolled in that offering).

## 5.9 Library

- **Info pages:** opening hours, rules, fines, contacts, e-resources (links to subscribed databases), how to access Wi-Fi / computer lab.
- **Catalogue search:** title/author/ISBN/subject, copies available, call number / shelf location.
- **My loans:** due dates, renew (if policy allows), fines.
- Integrates with Koha or the existing library system if present; otherwise librarians manage the catalogue in the portal (CSV import).

## 5.10 Announcements

- Author: admin, registry, librarian, lecturer (lecturers limited to their classes).
- Audience targeting: everyone, applicants, programme, year, class group, module offering.
- Schedule publish/expiry, pin, attachments, "must acknowledge" option (tracks who has read it).
- Delivered in-app + optional push/email/SMS.

## 5.11 Notifications preferences

Per student: channels (push, email, SMS) × categories (deadlines, announcements, results, library). SMS limited to high-priority to control costs.

## 5.12 Accessibility & devices

- Works on low-end Android phones and 3G; pages < 200 KB after first load.
- WCAG 2.2 AA: keyboard navigation, contrast, screen-reader labels.
- Installable PWA; offline view of timetable, deadlines and opened notes.
