# 12. Status and known gaps

Every screen in `design/` is built. This is what is not finished, what needs a decision or a detail
from the college, and what will need work as the data grows. Update it when any of these change.

## 12.1 Needs details from the college

| What | Where it shows | Until then |
| --- | --- | --- |
| SMS provider | Sign-up phone check, password reset codes, reminders, replies from Student Affairs | Texts queue in `sms_outbox`; development logs them. No SMS worker exists yet. `SIGNUP_VERIFY_PHONE` is off |
| SMTP server | Email check at sign-up (`AUTHENTIK_EMAIL__*`), reset codes by email (`SMTP_*`) | Nothing is sent; the address is kept unchecked |
| Google OAuth client | "Continue with Google" | Button hidden (`GOOGLE_CLIENT_ID`) |
| Payment provider (EcoCash, OneMoney) | design/Payment | Mobile money says it isn't available; a development simulator exists |
| Bank account details | design/PayOffice | Bank transfer isn't offered; cash at the Accounts Office works |
| Admissions contact, Student Affairs email and opening hours | Landing, ReviewNotEligible, AskHandoff | Left off the pages |
| Intake places per programme | `/staff/admissions/places` | "Not set" until Admissions enters them |
| Real Accounts officer | Seed | Placeholder name Nyasha Mapfumo (`nmapfumo`) |
| National ID check letters in the designs | IdError, seeds | The mod-23 rule in `app/ocr/national_id.py` is applied as specified |
| Retention periods | design/IdDesktop "[RETENTION PERIOD]", docs/07 | Not shown; no retention job runs (`RETENTION_*` aren't read) |

## 12.2 Needs a decision

- **Registry and admin roles** have no pages and no designs. They can sign in and are allowed into Find a student and some admissions actions, but have no home of their own.
- **Ask TCFL content.** It answers from the student's own records and announcements only. The retrieval index in §4.2 (`kb_documents`, `kb_chunks`, embeddings) isn't built, so policy questions go to Student Affairs. It needs the Student Handbook and other policies as documents, and a decision on where they're maintained.
- **Replies from Student Affairs** appear in Ask TCFL, not under Announcements as design/AskHandoff shows: that would need announcements addressed to one person.

## 12.3 Not built yet

- **SMS worker**: sends what's queued in `sms_outbox` and `notification_deliveries` once a provider is chosen.
- **Retention job**: deletes rejected applicants' documents and old chat transcripts after the agreed periods.
- **Ask TCFL retrieval index** (above).
- **Audit log**: staff views of applications, ID and certificate images, payment proofs and student profiles, decisions and payment actions are recorded (`app/services/audit.py`). Other staff edits (marks, announcements, library desk) are recorded in their own tables but not in `audit_log`, and there's no page to read the log.
- **Push notifications** (`push_subscriptions` exists; nothing sends).

## 12.4 Search: fine now, slow with real data

The search boxes (Find a student, the library catalogue, the student search, announcement search in
Ask TCFL) are fast today because the development data is tiny: about 80 students, 15 books and
5 announcements, on a local database. They are not built for a college's worth of records:

- **Queries are substring matches** (`ILIKE '%moyo%'`) over several columns. Postgres can't use an
  ordinary index for a leading `%`, so it reads every row.
- **The trigram indexes that exist aren't used.** `people_name_trgm` indexes
  `surname || ' ' || first_names`, but Find a student matches `first_names` and `surname`
  separately. `library_items_title_trgm` covers titles, but the catalogue search ORs title with
  authors, subjects, ISBN, call number and barcodes, which leads to a full scan.
- **No trigram index** on student numbers, book authors or copy barcodes.
- **The browser searches on every keystroke** (`useDeferredValue`, no pause), so a fast typist on
  3G sends several requests where one would do. TanStack Query caches repeated terms.
- **Announcement search in Ask TCFL** loads every announcement the student can see and scores them
  in Python. Fine for tens, not for thousands.

To fix, in order: search the indexed full-name expression; add `gin_trgm_ops` indexes on
`students.student_number`, `array_to_string(library_items.authors, ' ')` and
`library_copies.barcode`; wait about 250 ms after typing stops; move announcement search into
Postgres (full-text or trigram); then load a few thousand dummy records and measure with
`EXPLAIN ANALYZE`.

## 12.5 Other limits to know

- **Offline** keeps only the student's own pages, on phones, for 7 days (`web/src/lib/offline.ts`).
  Notes open offline only if the phone saved the download; the portal can't tell.
- **Sessions** end at a fixed time (14 days, 8 hours on a shared computer), not after idle time.
- **Personas** for testing are listed in [11-test-personas.md](11-test-personas.md).
- **No git remote**: the repository hasn't been pushed anywhere.
