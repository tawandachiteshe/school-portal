"""Read the front of a Zimbabwe National ID (docs/03 §3.1 stages 4–6).

Tesseract gives text and a confidence; the parser pulls out the ID number, names and date of birth.
Claude reads the photo instead when OCR misses a field, but only when an API key is configured,
OCR_LLM_MODE allows it and the applicant agreed to external AI extraction. Nothing here decides
anything: the applicant always checks the result (stage 8).
"""

import base64
import csv
import io
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import date

from app.config import get_settings
from app.ocr.national_id import decode

READABLE = {"image/jpeg", "image/png", "image/webp"}


@dataclass
class IdReading:
    id_number: str | None = None
    surname: str | None = None
    first_names: str | None = None
    date_of_birth: date | None = None
    confidence: dict[str, float] = field(default_factory=dict)
    engine: str = "none"
    text: str = ""

    @property
    def complete(self) -> bool:
        return bool(self.id_number and self.surname and self.first_names and self.date_of_birth)


def _tesseract(image: bytes) -> tuple[str, float]:
    """Text and mean word confidence (0..1)."""
    exe = shutil.which("tesseract")
    if not exe:
        return "", 0.0
    run = lambda fmt: subprocess.run(  # noqa: E731
        [exe, "stdin", "stdout", "--psm", "6", *fmt], input=image, capture_output=True, timeout=60
    )
    text = run([]).stdout.decode(errors="replace")
    tsv = run(["tsv"]).stdout.decode(errors="replace")
    confs = [
        float(r["conf"])
        for r in csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE)
        if r.get("conf") not in (None, "", "-1") and (r.get("text") or "").strip()
    ]
    return text, (sum(confs) / len(confs) / 100 if confs else 0.0)


LABELS = {
    "surname": re.compile(r"^\s*SURNAME\b[:\s]*(.*)$"),
    "first_names": re.compile(r"^\s*FIRST\s*NAMES?\b[:\s]*(.*)$"),
}
DOB = re.compile(r"\b(\d{2})\s*[/.-]\s*(\d{2})\s*[/.-]\s*(\d{4})\b")
NAME = re.compile(r"^[A-Z][A-Z' -]{1,40}$")


def _clean_name(value: str) -> str:
    """'CHITESHE 2' → 'CHITESHE': drop specks OCR reads as digits, marks or lone letters."""
    words = [w for w in re.sub(r"[^A-Z' -]", " ", value.upper()).split() if len(w.strip("'-")) >= 2]
    return " ".join(words)


def _variants(image: bytes) -> list[bytes]:
    """The photo, and copies that read better: the blue channel (drops the blue hologram and the
    yellow band on plastic IDs), stretched to full contrast, and a plain grey copy, both enlarged
    when small. Without Pillow, only the photo."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return [image]
    try:
        img = Image.open(io.BytesIO(image))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        return [image]
    if img.width < 1600:
        img = img.resize((img.width * 2, img.height * 2), Image.Resampling.LANCZOS)
    out = []
    for band in (img.getchannel("B"), ImageOps.grayscale(img)):
        buf = io.BytesIO()
        ImageOps.autocontrast(band, cutoff=1).save(buf, format="PNG")
        out.append(buf.getvalue())
    return [*out, image]


def _score(r: "IdReading") -> tuple[int, float]:
    fields = [r.id_number, r.surname, r.first_names, r.date_of_birth]
    d = decode(r.id_number or "")
    confs = list(r.confidence.values())
    return (
        sum(f is not None for f in fields) + (1 if d and d.check_letter_valid else 0),
        sum(confs) / len(confs) if confs else 0,
    )


def parse(text: str, confidence: float) -> IdReading:
    """ID card text → fields. Labels are followed by the value on the same line or the next."""
    r = IdReading(text=text, engine="tesseract")
    lines = [ln.strip().upper() for ln in text.splitlines() if ln.strip()]
    d = decode(text)
    if d:
        r.id_number = d.normalized
        r.confidence["id_number"] = confidence if d.check_letter_valid else min(confidence, 0.5)
    for key, rx in LABELS.items():
        for i, ln in enumerate(lines):
            m = rx.match(ln)
            if not m:
                continue
            value = _clean_name(m[1].strip() or (lines[i + 1] if i + 1 < len(lines) else ""))
            if NAME.match(value):
                setattr(r, key, value)
                r.confidence[key] = confidence
            break
    for m in DOB.finditer(text):
        try:
            r.date_of_birth = date(int(m[3]), int(m[2]), int(m[1]))
            r.confidence["date_of_birth"] = confidence
            break
        except ValueError:
            continue
    return r


def _claude(image: bytes, mime: str) -> IdReading | None:
    s = get_settings()
    if not s.anthropic_api_key:
        return None
    import anthropic

    client = anthropic.Anthropic(api_key=s.anthropic_api_key)
    tool = {
        "name": "national_id",
        "description": "Fields printed on the front of a Zimbabwe National ID card. "
        "Use null for anything unreadable.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id_number": {"type": ["string", "null"], "description": "e.g. 63-2047823 C 29"},
                "surname": {"type": ["string", "null"]},
                "first_names": {"type": ["string", "null"]},
                "date_of_birth": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            },
            "required": ["id_number", "surname", "first_names", "date_of_birth"],
        },
    }
    msg = client.messages.create(
        model=s.ocr_claude_model,
        max_tokens=400,
        tools=[tool],
        tool_choice={"type": "tool", "name": "national_id"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime,
                            "data": base64.b64encode(image).decode(),
                        },
                    },
                    {
                        "type": "text",
                        "text": "Read the fields on this National ID. Copy exactly what is printed.",
                    },
                ],
            }
        ],
    )
    data = next((b.input for b in msg.content if b.type == "tool_use"), None)
    if not isinstance(data, dict):
        return None
    r = IdReading(engine="llm")
    d = decode(data.get("id_number") or "")
    r.id_number = d.normalized if d else None
    for k in ("surname", "first_names"):
        v = (data.get(k) or "").strip().upper()
        if NAME.match(v):
            setattr(r, k, v)
    try:
        r.date_of_birth = date.fromisoformat(data.get("date_of_birth") or "")
    except ValueError:
        r.date_of_birth = None
    r.confidence = dict.fromkeys(("id_number", "surname", "first_names", "date_of_birth"), 0.85)
    return r


def read_national_id(image: bytes, mime: str, *, allow_llm: bool) -> IdReading:
    s = get_settings()
    reading = IdReading()
    if mime in READABLE:
        # First complete reading wins; otherwise the one with the most fields.
        for variant in _variants(image):
            text, conf = _tesseract(variant)
            if not text:
                continue
            r = parse(text, conf)
            if _score(r) > _score(reading):
                reading = r
            if (
                reading.complete
                and decode(reading.id_number or "")
                and decode(reading.id_number).check_letter_valid
            ):
                break
    low = any(v < s.ocr_min_confidence for v in reading.confidence.values())
    want_llm = s.ocr_llm_mode == "always" or (s.ocr_llm_mode == "fallback" and (not reading.complete or low))
    if allow_llm and want_llm and mime in READABLE:
        llm = _claude(image, mime)
        if llm:
            # Keep what OCR and Claude agree on at full confidence; otherwise prefer Claude's read.
            for k in ("id_number", "surname", "first_names", "date_of_birth"):
                a, b = getattr(reading, k), getattr(llm, k)
                if b is not None and a != b:
                    setattr(reading, k, b)
                    reading.confidence[k] = 0.7 if a else llm.confidence[k]
                elif a is not None and a == b:
                    reading.confidence[k] = max(reading.confidence.get(k, 0), 0.95)
            reading.engine = "llm" if reading.engine == "none" else reading.engine
    return reading
