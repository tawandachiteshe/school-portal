# 11. Test personas

Seventeen sample accounts, one for each role and each stage of an application, all created by the seed (`api/app/seed.py`, `api/app/seed_admissions.py`). Keep this file in step with the seed.

## Signing in

Every persona signs in at http://localhost:5173/login with the password `campus-dev-2027`. In development, http://localhost:5173/login/dev also lists them all and signs you in with one click, without Authentik.

- **Students** sign in with their student number (`CC/2027/0142`).
- **Applicants** sign in with their mobile number. Any form works: `077 210 0880`, `0772100880` or `263772100880`.
- **Staff** sign in with their username (`fchikore`) or college email (`fchikore@example.ac.zw`).

To put everything back to this starting point (it wipes all changes made while testing):

```bash
cd api
uv run python -m app.seed                      # add --results-published to show Semester 1 results
uv run python -m app.authentik_dev             # sign-ins for every persona, password back to campus-dev-2027
```

Phone numbers and staff names that aren't in the designs are made up for testing. The Accounts officer, Nyasha Mapfumo, is a placeholder until the real officer is known.

## Students

Two students in the same class, DIT-1A (Diploma in Information Technology, Semester 1). Tariro has the full set of records from the designs; Thandeka has few, so you can check one never sees the other's.

| Persona | Sign in as | Their situation | Use them to test |
| --- | --- | --- | --- |
| Tariro Moyo | `CC/2027/0142` | 4 things due in the next week, including DCN201 Test 1. Fees balance US$ 310.00, second instalment due Wednesday 4 November. One overdue book (Engineering Mathematics), one on loan, one reservation ready to collect. Unread announcements. Also an applicant whose application is still in review. Phone +263 77 318 4521 | Everything a student sees: dashboard, timetable, deadlines and submitting work, notes, library and renewing, fees, student card, Ask Campus |
| Thandeka Mpofu | `CC/2027/0147` | Same classes and deadlines as Tariro. One overdue book (Data Communications and Networking). No fees statement and no reservations. Phone +263 77 210 0147 | That students only see their own records, in the portal and in Ask Campus. A student with little on their account |

Neither has published results unless you reseed with `--results-published`. The other 79 students (36 in DIT-1A, 41 in DTE-1A and 2 in other classes) have records for the lecturer and library screens, but no sign-in.

## Applicants

One applicant at each stage of the 2027 intake, from not started to decided. Sign in with the mobile number.

| Persona | Sign in as | Stage | Use them to test |
| --- | --- | --- | --- |
| Chiedza Nyoni | `263772345678` | Nothing started | The whole application from the first step: programme, National ID, birth certificate, ZIMSEC results, review, fee, submit |
| Tatenda Mukanya | `263772100894` | Paid the US$ 20.00 fee in cash for the Diploma in Software Engineering; waiting for Accounts to confirm it (APP-27-08894) | The applicant's "waiting for Accounts" state. Accounts confirming or rejecting a cash payment |
| Nokuthula Ncube | `263772100880` | Submitted to the Diploma in Information Technology, in the review queue. Flagged: ID photo blurred (APP-27-08880) | The applicant's status page after submitting. Admissions reviewing a flagged application |
| Tariro Moyo | `CC/2027/0142` | In review with C. Marufu (APP-27-08813) | The in-review status. She's also a student, so she opens the student portal first |
| Tafadzwa Banda | `263772100801` | Admissions asked for a clearer photo of page 2 of the results slip (APP-27-08801) | Answering a request for more information |
| Munashe Chari | `263772100741` | Offered a place on the Diploma in Information Technology (APP-27-08741) | The offer: accepting or declining, registration details |
| Simba Tshuma | `263772100756` | Not accepted: the Telecommunications Engineering diploma needs Physical Science at C or better (APP-27-08756) | How a decision not to offer a place reads |

The review queue also holds 10 other applicants from the designs (Rudo Mhlanga, Tinashe Chirwa and others). They have records but no sign-in.

## Staff

One persona for each staff role that has pages, used on a laptop (1280 px). Registry and admin have no pages yet, so there are no personas for them.

| Persona | Sign in as | Role | Use them to test |
| --- | --- | --- | --- |
| Eng. Fungai Chikore | `fchikore` | Lecturer, Data Communications (DCN201 for DIT-1A and DTE-1A) | Today's classes, taking the register, entering marks, uploading notes |
| Dr Sipho Ncube | `sncube` | Lecturer, Engineering Mathematics (MTH110) | A second lecturer: they only see their own classes |
| Mrs Rumbidzai Ndlovu | `rndlovu` | Lecturer, Computer Networks (NET202) | As above |
| Mr Tendai Mutasa | `tmutasa` | Lecturer, Programming (PRG101) | As above |
| Chipo Marufu | `cmarufu` | Admissions officer | The applications queue, reviewing Tariro's application, asking for information, offering places |
| Nyasha Mapfumo | `nmapfumo` | Accounts officer (placeholder name) | Confirming or rejecting Tatenda's cash payment |
| Shamiso Chinembiri | `schinembiri` | Librarian, Block A desk | Issuing and returning books, overdue loans (Tariro and Thandeka have one each), reservations |
| Takudzwa Mushonga | `tmushonga` | Student Affairs officer | Writing announcements, replying to questions students send from Ask Campus |

## Which persona for what

| To test | Sign in as | Check |
| --- | --- | --- |
| A full application | Chiedza (`263772345678`) | Every step saves; photos can be taken on a phone from a computer |
| Paying and Accounts confirming | Tatenda (`263772100894`), then Nyasha (`nmapfumo`) | After Accounts confirms, Tatenda's application moves to the review queue and they get an SMS |
| Reviewing and deciding | Chipo (`cmarufu`), then the applicant | Tafadzwa sees the request, Munashe the offer, Simba the reason |
| The student day | Tariro (`CC/2027/0142`) | Dashboard, due items within 48 hours in amber, overdue book, fees due |
| Ask Campus | Tariro, then Thandeka (`CC/2027/0147`) | Answers cite their source; each sees only their own loans and deadlines; questions sent to Student Affairs reach Takudzwa (`tmushonga`) |
| Teaching | Eng. Chikore (`fchikore`) | Register and marks for DIT-1A; DTE-1A shows only DCN201 |
| Library desk | Shamiso (`schinembiri`) | Issue to Tariro, return Thandeka's overdue book |
| Catalogue and reading lists | Shamiso (`schinembiri`) | Search by barcode (`CC-B-003390`), add a book and its copies, add it to a module's reading list |
| Intake places | Chipo (`cmarufu`) | Places start "Not set"; after setting them, Remaining counts Munashe's offer |
| Find a student | Takudzwa (`tmushonga`) or Chipo | Search "moyo" or "0147"; the profile shows contacts and loans, never the ID number or results |
| Sign-up, sign-in and password reset | A new number, or Tariro | Codes appear in the API log until an SMS provider is set up |
