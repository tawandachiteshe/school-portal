# TCFL Portal — design handoff

Every screen below is a file in `design/`. Suggested routes are a starting point.

## Component mapping (shadcn/ui → how it's restyled)

| Design element | shadcn component | Notes |
|---|---|---|
| Primary / secondary / ghost / destructive buttons | `Button` variants `default`, `outline`, `ghost`, `destructive` (outline style: card bg, red text) | 44px tall on mobile, 36px (`sm`) allowed on staff desktop |
| Badges (Test, Assignment, Submitted, Recommended, In review) | `Badge` | 22px, radius 4, 12px/500. Variants: neutral outline, `urgent`, `success`, `destructive`, `info` (soft fill, no border) |
| Text fields, selects, textarea | `Input`, `Select`, `Textarea`, `Label` | 44px, radius 4, `border-input`. Error = 2px destructive border + message above field. Low confidence = 2px `urgent-line` + `urgent-soft` fill |
| Error summary / alerts | `Alert` | info (primary-soft, no border), success, urgent, destructive (2px red border, card bg) |
| Day tabs, module tabs, staff queue tabs | `Tabs` | underline style: 2px primary bar, 600 weight on active |
| Deadlines filter | `Tabs` or `ToggleGroup` | segmented on muted track |
| Staff tables | `Table` | 40px rows, header 14px/500 muted, hairlines only |
| Upload notes, Offer a place | `Dialog` | overlay `rgba(20,19,17,.48)`, no blur |
| Ask for information | `Sheet` side="right", 480px | |
| Signed out, large download | `Sheet` side="bottom" | radius 12 top corners, grab handle |
| Step progress (mobile) | 5 × 4px segments + "Step 3 of 5 · ZIMSEC results / Next: Review" | custom |
| Loading | `Skeleton` | keep known text (greeting, headings) real; skeleton only unknown rows |
| Upload progress | `Progress` | 6px |
| Toasts | `sonner` | bottom on phone, bottom-right desktop; never for errors needing action |
| Avatar | `Avatar` | initials, muted bg, 1px border |
| Switches | `Switch` | 44×24 |

## Screens

### Sign in (Authentik-driven)
| File | Screen | Route | Authentik |
|---|---|---|---|
| Landing / LandingPhone | Public home page for anyone signed out: intake, how applying works, programmes, dates, help. Facts from `GET /api/public/home`; unknown dates and contacts are left off | `/` (signed out) | none |
| SignIn | Sign in (phone) | `/login` | authentication flow: Identification → Password |
| StaffSignIn | Sign in (desktop, shared-computer checkbox) | `/login` | same flow |
| (no design) | Create applicant account: name, mobile number, password twice, in the style of SignIn. `design/Register.dc.html` is the lecturer's attendance register, not sign-up | `/register` | enrollment flow: Prompt stage |
| VerifyPhone / VerifyPhoneError | SMS code, wrong-code state (`state` prop). Only when `SIGNUP_VERIFY_PHONE` is set (docs/10 §10.3) | `/register` (next step of the same page) | Authenticator SMS stage, verify-only |
| ForgotPassword | Reset password | `/forgot` | recovery flow |

Identification stage only matches username/email/UPN: set applicant usernames to their E.164 number without `+` (e.g. `263773184521`) and students' to their student number.

### Applicant onboarding
| File | Screen | Route |
|---|---|---|
| ProgrammeMobile / ProgrammeDesktop | A · Choose programme (requirements visible) | `/apply/programme` |
| IdDesktop | B · National ID: phone (recommended) or upload | `/apply/id` |
| Handoff | C · QR, short link, SMS link, match code K7Q2, expiry | `/apply/id/phone` |
| HandoffReading / HandoffWaiting | C · Phone connected, live checklist (`stage` prop: reading, read) | same |
| HandoffExpired | C · Link expired | same |
| PhoneLanding | D · "Continuing Tariro's application", match code | `/h/:code` |
| CodesMismatch | D · Codes don't match | `/h/:code/mismatch` |
| PhoneCamera | D · ID capture with live hints (`hint` prop) | `/h/:code/capture` |
| CameraBlocked | Camera permission denied | same |
| PhoneCheck | D · Decoded ID, editable name and DOB | `/h/:code/check` |
| IdError | F · Invalid check letter, highlighted character | same |
| PhoneDone / PhoneDisconnected | D · Done; computer ended session | `/h/:code/done` |
| (no design yet) | Birth certificate: photo or scan, name and date of birth as printed; follows the National ID screens. Steps become Programme · National ID · Birth certificate · ZIMSEC results · Review · Submit | `/apply/birth-certificate`, phone `/h/:code/birth-certificate` |
| ZimsecCamera / ZimsecPages | E · Slip capture (A4 outline), page review | `/apply/results/scan` |
| Zimsec / ZimsecDesktop | E · Editable results table, low-confidence cells with crop | `/apply/results` |
| ReviewEligible / ReviewNotEligible / ReviewDesktop | G · Review + eligibility | `/apply/review` |
| Submit / SubmitError / SubmitDesktop | Step 5 · Declaration (`state` prop) | `/apply/submit` |
| Payment / PayWaiting / PayFailed / PayOffice | Step 5 · Fee: EcoCash push, failure, bank transfer | `/apply/pay` |
| Submitted | Submitted, reference | `/apply/submitted` |
| Status / StatusDesktop | H · Timeline Submitted → In review → Decision | `/apply/status` |
| OfferReceived | Offer: accept by, next steps | `/apply/offer` |

Handoff mechanics: desktop creates a short-lived session (15 min) with a 4-char match code and short link; phone joins by QR/link; desktop receives live updates (SSE or WebSocket; fall back to polling on 3G). Either device can finish. Desktop "Disconnect" ends the phone session.

### Student app
| File | Screen | Route |
|---|---|---|
| Main (MainDark = dark theme) | Dashboard | `/` |
| Modules / ModuleDetail | Modules, module overview | `/modules`, `/modules/:code` |
| Deadlines | Upcoming/Submitted/Marked, grouped by week | `/deadlines` |
| SubmitWork / SubmitQueued / SubmitFailed | Upload (`state`: uploading, queued, failed) | `/deadlines/:id/submit` |
| Library | Loans, reservations, reading lists | `/library` |
| More | Profile, records, settings (data saver, SMS) | `/more` |
| Timetable | Week/day view | `/timetable` |
| AnnouncementDetail | Announcement + "affects you" line | `/announcements/:id` |
| Results | Published results | `/results` |
| Fees | Balance, statement, payment reference | `/fees` |
| StudentCard | Offline digital card with barcode | `/card` |
| AskStart / AskChat / AskHandoff | Assistant: start, answers with sources, hand to Student Affairs | `/ask` |
| StateLoading / StateOffline / StateEmpty / StateSession / DownloadSheet | Loading, offline, empty, signed out, large download | — |

Amber rule on the dashboard/deadlines: `due - now <= 48h` and not submitted → `urgent` badge with relative time; else muted relative time; submitted → muted "Submitted" with green check.

### Staff
| File | Screen | Route |
|---|---|---|
| StaffQueue | Admissions queue | `/staff/admissions` |
| StaffReview | Application review | `/staff/admissions/:ref` |
| OfferDialog / AskInfo | Offer a place (Dialog), ask for information (Sheet) | same |
| LecturerHome | Lecturer today | `/staff/teaching` |
| LecturerMarks | Enter marks | `/staff/teaching/assessments/:id/marks` |
| LecturerUpload | Class notes + upload dialog | `/staff/teaching/classes/:id/notes` |
| Register | Take the register (phone) | `/staff/teaching/sessions/:id/register` |
| LibraryDesk / LibraryOverdue | Issue/return desk, overdue loans | `/staff/library`, `/staff/library/overdue` |
| AnnouncementCompose | Write an announcement (audience, pin, SMS) | `/staff/announcements/new` |
| Foundations | Tokens and primitives reference | — |

## Open questions (placeholders in the designs)

- Official TelOne colours (primary is a stand-in).
- Application fee amount (US$ 20.00 used), payment provider (e.g. Paynow), bank name and account number, which methods to offer.
- Semester fees and payment options for students.
- ZIMSEC subject codes (1122, 4004, 5009, 4021, 2248, 3159 used), programme durations and entry requirements.
- Policies: document retention period, make-up test rule, re-mark window, upload deadline rule
  (tap time vs upload-finished time), loan period, SMS code attempts and expiry.
- Staff names, office rooms, opening hours.

## Suggested build order

1. `globals.css` theme + shadcn primitives restyled; a Foundations page in Storybook.
2. App shells: student (top bar + bottom nav), applicant (steps), staff (sidebar).
3. Authentik flow executor client + sign-in/register/verify screens.
4. Applicant flow A → H including the phone handoff (the riskiest piece).
5. Student dashboard and tabs, with offline cache (service worker) and upload queue.
6. Staff admissions, lecturer, library screens.
7. Ask TCFL (retrieval over official documents, always cite sources, hand off when unsure).
