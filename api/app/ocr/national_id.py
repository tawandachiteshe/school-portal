"""Zimbabwe national ID decoding and mod-23 check-letter validation.

Format: RR-SSSSSS(S) L OO
  RR  registration district code (2 digits)
  S…  serial (6 or 7 digits)
  L   check letter = LETTERS[int(RR + SERIAL) % 23]  (no I, O or U)
  OO  district of origin (2 digits)

Verified against published samples 08-2047823Q29 and 631222666S70 (docs/01 §1.3).
District names are informational only; never reject on a district lookup.
"""

import re
from dataclasses import dataclass

LETTERS = "ZABCDEFGHJKLMNPQRSTVWXY"  # index 0 = Z

ID_RE = re.compile(
    r"(?P<reg>\d{2})\s*-?\s*(?P<serial>\d{6,7})\s*-?\s*(?P<letter>[A-HJ-NP-Z])\s*-?\s*(?P<origin>\d{2})"
)

# Common OCR confusions, applied only inside digit runs.
_DIGIT_FIXES = str.maketrans({"O": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2"})
_DIGIT_RUN = re.compile(r"[0-9ODILSBZ]{2}\s*-?\s*[0-9ODILSBZ]{6,7}")


@dataclass(frozen=True)
class DecodedId:
    normalized: str
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


def _fix_digits(text: str) -> str:
    # May over-correct with 6-digit serials (e.g. swallow an S check letter). Acceptable:
    # the result is always re-validated and shown to the applicant, never auto-accepted.
    return _DIGIT_RUN.sub(lambda m: m.group(0).translate(_DIGIT_FIXES), text)


def decode(raw: str, districts: dict[str, str] | None = None) -> DecodedId | None:
    districts = districts or {}
    text = raw.upper().replace("—", "-").replace("–", "-")
    m = ID_RE.search(text) or ID_RE.search(_fix_digits(text))
    if not m:
        return None
    reg, serial, letter, origin = m["reg"], m["serial"], m["letter"], m["origin"]
    exp = expected_letter(reg, serial)
    return DecodedId(
        normalized=f"{reg}-{serial} {letter} {origin}",
        reg_code=reg,
        serial=serial,
        check_letter=letter,
        origin_code=origin,
        check_letter_valid=letter == exp,
        expected_letter=exp,
        reg_district=districts.get(reg),
        origin_district=districts.get(origin),
    )
