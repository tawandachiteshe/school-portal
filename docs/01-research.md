# 1. Research

## 1.1 The problem

Onboarding at the college today is mostly manual. It looks like this:

1. Applicants bring physical copies of their ZIMSEC certificates, result slips and national ID.
2. Admissions staff read each document and type the details into the student system. They check the entry requirements by hand.
3. Once students are registered, their information is scattered across several places: notices, WhatsApp groups, the e-learning site, and the lecturers themselves.

This causes several problems:

- **Slow intake.** Queues form at registration, and applicants outside Harare have to travel.
- **Transcription errors.** Names, ID numbers and grades get mistyped.
- **Weak fraud detection.** Forged or altered result slips are hard to spot by eye.
- **No single place for students.** Nothing tells a student "what's due, where, and who teaches it".

The college already runs blended and online learning. The new portal should **integrate** with the existing LMS where one exists, not replace it on day one.

## 1.2 ZIMSEC documents

### What the documents contain

A ZIMSEC result slip and certificate carry these fields:

| Field | Format / notes |
|-------|----------------|
| Candidate name | Surname first, then first name(s) or initials. This is the same order ZIMSEC's portal uses. |
| Centre number | **6 digits** (examination centre code) |
| Candidate number | **4 digits**, unique within the centre |
| Exam session | June or November, plus the year |
| Level | Grade 7, O-Level, A-Level |
| Subjects | Subject code, subject name, grade |
| Date of birth | dd/mm/yyyy on the candidate record |

Sources: [Techzim: How to check O-Level results (2026)](https://www.techzim.co.zw/2026/01/how-to-check-olevel-results-zimsec-website-2026-update/), [ZIMSEC Online Results Distribution Manual (June 2025)](https://www5.zimsec.co.zw/wp-content/uploads/2025/08/Online-Results-Distribution-Manual-June-2025.pdf).

### Grades and their meaning

| Grade | Meaning | Counts as a pass for entry? |
|-------|---------|-----------------------------|
| A, B, C | Pass (GCE standard) | Yes |
| D, E | Recorded, lower attainment | No (configurable) |
| U | Ungraded | No |
| X | Absent | No |
| M / M-W / M-W-N | No result, withheld for suspected malpractice, or cancelled | No, and **flag for manual review** |

A-Level grades use A–E (and O for an O-Level pass at A-Level). Any M-W or M-W-N grade must go to a human reviewer.

### Verification with ZIMSEC

ZIMSEC runs a **confirmation of results** service. Institutions and employers use it to verify results, including provisional statements before certificates are issued ([ZIMSEC confirmation of results](https://www5.zimsec.co.zw/confirmation-of-results-information-sheet/), [ZIMSEC exam results portal](https://www5.zimsec.co.zw/exam-results-information/)). ZIMSEC does **not** publish a public machine-readable verification API. The design therefore:

- treats OCR output as **"claimed results"**, never as verified results;
- captures the centre number, candidate number and session, which are exactly what ZIMSEC's confirmation service needs;
- supports a **batch export** of claims for the registry to submit to ZIMSEC, and records the outcome ("verified", "mismatch", or "pending") per student;
- has a pluggable `ZimsecVerifier` interface, so an official API can be added later if ZIMSEC offers one under an MoU.

### Physical document challenges for OCR

- Result slips are often **photocopies of photocopies**. Expect low contrast, skew, stamps and signatures over text.
- Phone photos bring perspective distortion, glare and shadows.
- Certificates carry security backgrounds (guilloche patterns and a watermark) that confuse plain OCR.
- Older certificates may use different layouts or fonts than current slips.

These are the reasons behind the preprocessing steps and the "LLM-assisted structuring plus human review" design in [03-ocr-and-id-pipeline.md](03-ocr-and-id-pipeline.md).

## 1.3 Zimbabwe national ID number

### Format

```
63-1234567 K 00
│   │      │ └── district code of origin (2 digits)
│   │      └──── check letter
│   └─────────── serial / sequence number (6 or 7 digits)
└─────────────── registration district code (2 digits)
```

Common written forms are `632047823Q29`, `63-2047823Q29`, `63-2047823-Q-29` and `63-2047823 Q 29`. A tolerant regex:

```
^\d{2}-?\s?\d{6,7}\s?-?\s?[A-HJ-NP-Z]\s?-?\s?\d{2}$
```

### Check-letter algorithm (verified)

1. Take **all digits before the letter** (registration code plus serial) as one integer.
2. Compute `n mod 23`.
3. Map the remainder with the table `Z A B C D E F G H J K L M N P Q R S T V W X Y` (index 0 = Z). The letters I, O and U are never used.

```python
LETTERS = "ZABCDEFGHJKLMNPQRSTVWXY"
def check_letter(digits_before_letter: str) -> str:
    return LETTERS[int(digits_before_letter) % 23]
```

I checked this against two independent published sample IDs. `082047823` gives **Q** (sample `08-2047823Q29` from the [zimbabwean-id-number-validator](https://pypi.org/project/zimbabwean-id-number-validator/) package). `631222666` gives **S** (sample `631222666S70` from [africa-id-check-javascript](https://github.com/dzinampini/africa-id-check-javascript)). Both match.

### District codes

Examples: 08 Bulawayo, 63 Harare, 75 Mutare, 22 Masvingo, 29 Gweru, 58 Kwekwe, 02 Beitbridge. The full list, with province, comes from [Umlamulankunzi/Zim_ID_Codes](https://github.com/Umlamulankunzi/Zim_ID_Codes) and [TrueID's district code list](https://trueidzim.com/articles/zimbabwe-id-district-codes).

> ⚠️ Community sources **disagree** on a few codes. For example, 13 is listed as both Chipinge and Chivi, and Mwenezi appears as both 05 and 54. Store the table as editable reference data in the database, not as hard-coded values. Treat a decoded district as **informational**. Never reject an application because of the district lookup alone; reject on a check-letter failure only. Before production, confirm the table with the Registrar General's office if possible.

### What "decoding" can and cannot tell you

| Can tell | Cannot tell |
|----------|-------------|
| Whether the number is well-formed and the check letter is valid | Whether the ID really belongs to this person |
| The district where the ID was registered | Date of birth or gender. Unlike South African IDs, these are not encoded. |
| The district of origin | Whether the ID is current, lost or revoked. That needs the Registrar General. |

For identity assurance, the portal therefore also compares the **name and date of birth OCR'd from the ID card** against the ZIMSEC documents, with fuzzy matching, and flags mismatches.

## 1.4 OCR technology options

| Option | Strengths | Weaknesses | Fit |
|--------|-----------|------------|-----|
| **Tesseract 5** | Tiny, runs on CPU, mature, free | Weaker on photos, skew and noisy backgrounds; no layout understanding | Fallback / offline baseline |
| **PaddleOCR (PP-OCRv5 / PaddleOCR-VL)** | Top open-source accuracy, good on photos, detection plus recognition, reads tables; CPU-usable | Heavier install; GPU helps for volume | **Primary self-hosted OCR engine** |
| **docTR** | Good on structured forms, clean Python API | Smaller community | Alternative to PaddleOCR |
| **Cloud OCR** (Google Document AI, AWS Textract, Azure) | Very accurate, managed | Sends personal data offshore (needs a legal basis under the CDPA), costs per page | Optional |
| **Vision LLM (Claude)** | Reads messy photos, understands layout, returns **structured JSON** directly, can explain uncertainty | Per-call cost; data leaves the country | **Structuring and validation layer** on top of OCR, or the sole reader for hard cases |

Benchmarks: [CodeSOTA PaddleOCR vs Tesseract vs EasyOCR (2026)](https://www.codesota.com/ocr/paddleocr-vs-tesseract), [Reducto: best OCR models 2026](https://reducto.ai/guides/best-ocr-models-accuracy-speed-cost), [IntuitionLabs: non-LLM OCR engines](https://intuitionlabs.ai/articles/non-llm-ocr-technologies).

**Decision:** use a hybrid pipeline. It runs in four steps:

1. OpenCV preprocessing.
2. PaddleOCR produces text and bounding boxes (self-hosted).
3. Deterministic parsers try to extract the fields (regex, subject-code table).
4. If confidence is low, or on every certificate if the college prefers, the image plus OCR text goes to **Claude** with a strict JSON schema, and Claude returns structured fields with per-field confidence.

Every extraction is shown to the applicant to confirm, and to staff to approve. Details are in [03-ocr-and-id-pipeline.md](03-ocr-and-id-pipeline.md).

Step 4 is configurable (`OCR_LLM_MODE=off|fallback|always`), so the college can run fully on-premises if data-protection advice requires it.

## 1.5 Legal and regulatory context

- **Cyber and Data Protection Act [Chapter 12:07]** governs processing of personal data. POTRAZ is the Data Protection Authority ([MISA](https://zimbabwe.misa.org/2025/03/14/navigating-the-data-protection-act-requirements-ensuring-compliance-for-zimbabwean-data-controllers/), [DLA Piper Africa](https://www.dlapiperafrica.com/en/zimbabwe/insights/2024/A-Quick-Start-Guide-to-Zimbabwes-Data-Protection-Regulations)).
- **SI 155 of 2024** (licensing of data controllers and appointment of DPOs) requires:
  - a **data controller licence** from POTRAZ (Form DP1), valid 12 months, with fees tiered from about US$50 to US$2,000;
  - an appointed **Data Protection Officer** (Form DP2).

  The licence application asks what sensitive data you process, what safeguards you use, and whether data is stored outside Zimbabwe.
- National ID numbers, academic records and photos count as personal data, so the portal must support consent, access requests, retention limits and breach notification.

The college (or its parent organisation) probably already holds a licence. The portal's processing should be **added to the existing registration**, and the DPO should review this design. See [07-security-and-compliance.md](07-security-and-compliance.md).

## 1.6 Stakeholders interviewed / to interview

| Stakeholder | Needs |
|-------------|-------|
| Applicants | Apply from a phone, get a fast decision, avoid travelling |
| Admissions / registry | Less typing, reliable data, fraud flags, bulk ZIMSEC verification |
| Students | One place for results, timetable, deadlines, notes, announcements |
| Lecturers | Post notes, assignments and tests once, and have them reach the right class |
| Librarians | Publish catalogue info, opening hours, loans and overdue reminders |
| ICT department | Easy to host, back up and integrate with existing systems (LMS, finance) |
| DPO / management | Compliance, audit trail, reports |

## 1.7 Sources

- [ZIMSEC: Online Results Distribution Manual (June 2025)](https://www5.zimsec.co.zw/wp-content/uploads/2025/08/Online-Results-Distribution-Manual-June-2025.pdf)
- [ZIMSEC: Confirmation of results information](https://www5.zimsec.co.zw/confirmation-of-results-information-sheet/)
- [ZIMSEC: Exam results portal](https://www5.zimsec.co.zw/exam-results-information/)
- [Techzim: How to check O-Level results (2026)](https://www.techzim.co.zw/2026/01/how-to-check-olevel-results-zimsec-website-2026-update/)
- [zimbabwean-id-number-validator (PyPI)](https://pypi.org/project/zimbabwean-id-number-validator/)
- [dzinampini/africa-id-check-javascript](https://github.com/dzinampini/africa-id-check-javascript)
- [Umlamulankunzi/Zim_ID_Codes](https://github.com/Umlamulankunzi/Zim_ID_Codes)
- [TrueID: Zimbabwe ID number explained](https://trueidzim.com/articles/zimbabwe-id-number-explained)
- [jamesdube: Zimbabwe National ID regex gist](https://gist.github.com/jamesdube/479842b73044b88bbb1399b52ceb92f5)
- [CodeSOTA: PaddleOCR vs Tesseract (2026)](https://www.codesota.com/ocr/paddleocr-vs-tesseract)
- [Reducto: Best OCR models 2026](https://reducto.ai/guides/best-ocr-models-accuracy-speed-cost)
- [MISA Zimbabwe: Data Protection Act requirements](https://zimbabwe.misa.org/2025/03/14/navigating-the-data-protection-act-requirements-ensuring-compliance-for-zimbabwean-data-controllers/)
- [DLA Piper Africa: Quick-start guide to Zimbabwe's data protection regulations](https://www.dlapiperafrica.com/en/zimbabwe/insights/2024/A-Quick-Start-Guide-to-Zimbabwes-Data-Protection-Regulations)
