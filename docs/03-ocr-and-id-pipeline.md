# 3. OCR & National ID Pipeline

Goal: turn a phone photo or scan of a **ZIMSEC result slip / certificate** or **national ID** into verified, structured data — with the applicant and an admissions officer confirming every field.

> Principle: **OCR proposes, humans dispose.** Nothing extracted automatically is treated as final until the applicant confirms it and staff approve it. ZIMSEC data remains "claimed" until confirmed through ZIMSEC's confirmation service.

## 3.1 Pipeline stages

```
upload ─▶ 1 intake ─▶ 2 preprocess ─▶ 3 classify ─▶ 4 OCR ─▶ 5 parse ─▶ 6 LLM structure (optional)
                                                                          │
      10 approve ◀─ 9 staff review ◀─ 8 applicant confirm ◀─ 7 validate ◀─┘
```

| # | Stage | What happens | Code |
|---|-------|--------------|------|
| 1 | Intake | Accept JPEG/PNG/HEIC/PDF ≤ 15 MB via presigned MinIO URL. Compute SHA-256 (duplicate detection across applicants). Strip EXIF GPS. Convert PDF pages → images (300 DPI). | `onboarding/uploads.py` |
| 2 | Preprocess | Resize long edge to ~2000 px; detect document quadrilateral & perspective-correct; deskew (Hough / min-area-rect); denoise (non-local means); CLAHE contrast; optional adaptive threshold for Tesseract. **Quality gate**: reject with a friendly retake prompt if blur (variance of Laplacian) < threshold or document < 60 % of frame. | `ocr/preprocess.py` |
| 3 | Classify | Which document is it? Keyword scoring on a fast first OCR pass ("ZIMBABWE SCHOOL EXAMINATIONS COUNCIL", "ORDINARY LEVEL", "ADVANCED LEVEL", "NATIONAL REGISTRATION", "REGISTRAR GENERAL"). The applicant also selects the type in the UI; a mismatch raises a flag. | `ocr/classify.py` |
| 4 | OCR | PaddleOCR (text + boxes + confidence). If mean confidence < 0.80, retry with Tesseract on the thresholded image and keep the better result. | `ocr/engines.py` |
| 5 | Parse | Deterministic extraction (regex + layout heuristics + subject-code dictionary). Produces fields with confidences. | `ocr/zimsec.py`, `ocr/national_id.py` |
| 6 | LLM structure | If `OCR_LLM_MODE=always`, or `fallback` and any required field is missing / low-confidence, send the image + OCR text to Claude with a strict JSON schema. Merge: fields agreeing between parser and LLM get boosted confidence; disagreements are flagged. | `ocr/llm_extract.py` |
| 7 | Validate | ID check letter, grade vocabulary, centre (6 digits) / candidate (4 digits) numbers, year sanity, name consistency across documents, duplicate candidate numbers across applicants. | `ocr/validate.py` |
| 8 | Applicant confirm | Form pre-filled with extracted values; low-confidence fields highlighted; image crop shown next to each field. Applicant edits → edits are logged. | `web/src/pages/apply` |
| 9 | Staff review | Queue sorted by risk score. Side-by-side original + fields + flags + diff of applicant edits vs OCR. | `web/src/pages/admissions` |
| 10 | Approve | Locks the record, runs eligibility, queues for ZIMSEC confirmation batch. | `onboarding/review.py` |

## 3.2 National ID decoding

```python
# api/app/ocr/national_id.py
import re
from dataclasses import dataclass

LETTERS = "ZABCDEFGHJKLMNPQRSTVWXY"          # index 0 = Z; no I, O, U
ID_RE = re.compile(
    r"(?P<reg>\d{2})\s*-?\s*(?P<serial>\d{6,7})\s*-?\s*(?P<letter>[A-HJ-NP-Z])\s*-?\s*(?P<origin>\d{2})"
)

# OCR commonly confuses these; only applied inside the digit groups.
DIGIT_FIXES = str.maketrans({"O": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2"})

@dataclass
class DecodedId:
    normalized: str            # e.g. "63-2047823 Q 29"
    reg_code: str
    serial: str
    check_letter: str
    origin_code: str
    check_letter_valid: bool
    expected_letter: str
    reg_district: str | None
    origin_district: str | None

def expected_letter(reg: str, serial: str) -> str:
    return LETTERS[int(reg + serial) % 23]

def decode(raw: str, districts: dict[str, str]) -> DecodedId | None:
    text = raw.upper().replace("—", "-").replace("–", "-")
    m = ID_RE.search(text)
    if not m:
        # retry with OCR digit fixes applied to everything except a single trailing-letter slot
        m = ID_RE.search(_fix_digits(text))
        if not m:
            return None
    reg, serial, letter, origin = m["reg"], m["serial"], m["letter"], m["origin"]
    exp = expected_letter(reg, serial)
    return DecodedId(
        normalized=f"{reg}-{serial} {letter} {origin}",
        reg_code=reg, serial=serial, check_letter=letter, origin_code=origin,
        check_letter_valid=(letter == exp), expected_letter=exp,
        reg_district=districts.get(reg), origin_district=districts.get(origin),
    )

def _fix_digits(text: str) -> str:
    # Fix confusables in runs that look like "NN-NNNNNNN". With 6-digit serials this can
    # swallow the check letter (e.g. S→5); that's acceptable because the result is always
    # re-validated and shown to the applicant for confirmation, never auto-accepted.
    def repl(m: re.Match) -> str:
        return m.group(0).translate(DIGIT_FIXES)
    return re.sub(r"[0-9ODILSBZ]{2}\s*-?\s*[0-9ODILSBZ]{6,7}", repl, text)
```

Tests (must pass):

```python
def test_known_samples():
    assert expected_letter("08", "2047823") == "Q"   # 08-2047823Q29
    assert expected_letter("63", "1222666") == "S"   # 631222666S70
```

**How the result is used**

- `check_letter_valid == False` → most often an OCR misread. Show the applicant: *"We read your ID as 63-2047823 **P** 29 — please check."* If the applicant-confirmed value still fails, block submission (a real ID cannot fail the check).
- If exactly one digit substitution makes the check pass, suggest it (typical OCR error), but never auto-apply.
- District names are **displayed**, never used to reject (reference table is community-sourced — see research §1.3).
- The ID card's **surname, first names, DOB** (OCR'd from the card) are fuzzy-matched (Jaro-Winkler ≥ 0.9 after normalising case/spacing) against the ZIMSEC candidate name. ZIMSEC prints *Surname First-names*; handle initials and maiden-name cases by flagging, not rejecting.

## 3.3 ZIMSEC result slip / certificate parsing

### Fields and rules

| Field | Rule |
|-------|------|
| `level` | `O` or `A` from "ORDINARY LEVEL" / "ADVANCED LEVEL" |
| `session` | `JUNE` or `NOVEMBER` + 4-digit year (1980 ≤ year ≤ current) |
| `centre_number` | exactly 6 digits |
| `candidate_number` | exactly 4 digits |
| `candidate_name` | uppercase letters, spaces, hyphens, apostrophes |
| `subjects[]` | `{code, name, grade}`; code 4 digits; grade in `A B C D E U X` (O-Level) or `A B C D E O F` (A-Level) or `M` variants |

### Subject matching

1. Look for rows of the form `CODE NAME … GRADE` using the OCR boxes (same baseline ± tolerance).
2. Match `CODE` against `zimsec_subjects` reference table (seeded from a ZIMSEC syllabus list; admin-editable).
3. If the code is unreadable, fuzzy-match the subject name (RapidFuzz token-sort ratio ≥ 85).
4. If code and name disagree (code says Mathematics, name says Geography), flag.

### Claude structured extraction (stage 6)

Uses the official `anthropic` SDK, a JSON schema enforced via structured outputs, and the image itself so the model can read what OCR missed.

```python
# api/app/ocr/llm_extract.py
import base64
from typing import Literal
from pydantic import BaseModel, ConfigDict
import anthropic

from app.config import settings

client = anthropic.Anthropic()          # reads ANTHROPIC_API_KEY

class Subject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str | None
    name: str
    grade: str
    confidence: float                   # 0..1, model's own estimate

class ZimsecExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_type: Literal["result_slip", "certificate", "not_zimsec"]
    level: Literal["O", "A"] | None
    session: Literal["JUNE", "NOVEMBER"] | None
    year: int | None
    centre_number: str | None
    candidate_number: str | None
    candidate_name: str | None
    subjects: list[Subject]
    tampering_signs: list[str]          # e.g. "grade column font differs", "overwritten digit"
    notes: str | None

SYSTEM = (
    "You extract data from Zimbabwe School Examinations Council (ZIMSEC) result slips and "
    "certificates for a college admissions office. Copy values exactly as printed; never guess. "
    "If a value is unreadable, return null and explain in notes. Report any visual signs of "
    "alteration in tampering_signs. OCR text is provided as a hint and may contain errors; "
    "the image is authoritative."
)

def extract(image_bytes: bytes, media_type: str, ocr_text: str) -> ZimsecExtraction:
    response = client.beta.messages.create(
        model=settings.claude_model,                     # default "claude-opus-5"
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",                              # re-run on a fallback model if declined
        system=SYSTEM,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type,
                    "data": base64.standard_b64encode(image_bytes).decode(),
                }},
                {"type": "text", "text": f"OCR hint:\n<ocr>\n{ocr_text}\n</ocr>\nExtract the fields."},
            ],
        }],
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": ZimsecExtraction.model_json_schema()},
        },
    )
    if response.stop_reason == "refusal":
        raise ExtractionDeclined(getattr(response.stop_details, "category", None))
    text = next(b.text for b in response.content if b.type == "text")
    return ZimsecExtraction.model_validate_json(text)

class ExtractionDeclined(Exception):
    pass
```

Notes:
- `claude_model` is configurable (`CLAUDE_MODEL` env var). Default is `claude-opus-5`; the college can pick a different model to balance cost and accuracy after measuring on its own sample set (§3.6).
- The same pattern with a smaller schema (`surname`, `first_names`, `dob`, `id_number`, `place_of_birth`) handles the **ID card** image; the deterministic `decode()` above always re-validates the number the model returns.
- Set `OCR_LLM_MODE=off` for a fully on-premises deployment (no images leave the server).

## 3.4 Fraud and risk signals

Each signal adds to a `risk_score` used to order the review queue. None auto-rejects.

| Signal | Weight |
|--------|--------|
| ID check letter invalid after applicant confirmation | block |
| Same document SHA-256 used by another applicant | high |
| Same centre + candidate + session claimed by another applicant | high |
| Name mismatch between ID and ZIMSEC documents | medium |
| LLM `tampering_signs` non-empty | medium |
| Applicant changed a **grade** from the OCR value | medium |
| Grade `M-W` / `M-W-N` present | medium |
| Low image quality accepted after 3 retakes | low |
| Error Level Analysis / font inconsistency heuristics on the grades region | low |

The final safeguard is the **ZIMSEC confirmation batch** before registration is finalised.

## 3.5 Eligibility rules

Programme entry requirements are stored as JSON on `programmes.entry_rules_json` so admissions can edit them without code:

```json
{
  "o_level": {
    "min_passes": 5,
    "pass_grades": ["A", "B", "C"],
    "required_subjects": [
      {"any_of": ["English Language"]},
      {"any_of": ["Mathematics"]},
      {"any_of": ["Physical Science", "Combined Science", "Physics", "Computer Science"], "optional": true}
    ],
    "max_sittings": 2
  },
  "a_level": null,
  "mature_entry": {"min_age": 25, "requires_interview": true}
}
```

> The numbers above are **examples** — confirm the college's actual entry requirements per programme with admissions before go-live.

`eligibility.evaluate(applicant)` returns `eligible | not_eligible | needs_review` plus a human-readable explanation shown to both applicant and staff.

## 3.6 Measuring accuracy

Before launch, build a **labelled test set**: 100–200 real (consented, anonymised) documents covering phone photos, scans, photocopies, old and new layouts.

| Metric | Target |
|--------|--------|
| ID number exact-match | ≥ 98 % (after preprocessing) |
| Subject + grade row accuracy | ≥ 97 % |
| Centre/candidate number exact-match | ≥ 98 % |
| Fields needing applicant correction | ≤ 10 % of documents |
| Median processing time per page | ≤ 10 s |

Run `python -m app.scripts.eval_ocr --dataset data/ocr-eval/` to compare engines and `OCR_LLM_MODE` settings; keep the report in `docs/reports/`.

## 3.7 Capture UX tips (applicant side)

- Live camera overlay with document outline; auto-capture when steady and sharp.
- Instant quality feedback ("Too dark", "Move closer", "Glare on the grades").
- Allow multiple pages per document; allow PDF upload from WhatsApp-received scans.
- Works on 3G: compress client-side to ~1 MB JPEG before upload; resumable uploads.
