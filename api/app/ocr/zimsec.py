"""Read a ZIMSEC result slip or certificate (docs/03 §3.3).

Tesseract's word boxes give each grade a confidence and a position, so the applicant can be
shown the crop of anything we weren't sure about (design/Zimsec, ZimsecDesktop). Subjects are
matched to the reference table by code, or by name when the code is unreadable.
"""

import csv
import io
import re
import shutil
import subprocess
from dataclasses import dataclass, field, replace

from rapidfuzz import fuzz, process

GRADES_O = {"A", "B", "C", "D", "E", "U", "X"}
GRADES_A = {"A", "B", "C", "D", "E", "O", "F"}
READABLE = {"image/jpeg", "image/png", "image/webp"}


@dataclass
class Word:
    text: str
    conf: float
    left: int
    top: int
    width: int
    height: int
    line: tuple[int, int, int]


@dataclass
class SubjectRead:
    code: str | None
    name: str
    grade: str | None
    confidence: float
    bbox: dict | None  # {"x","y","w","h"} of the grade, in page pixels
    read_as: str | None = None  # the raw character when it wasn't a valid grade


@dataclass
class SlipRead:
    level: str | None = None
    session: str | None = None
    year: int | None = None
    centre_number: str | None = None
    candidate_number: str | None = None
    candidate_name: str | None = None
    subjects: list[SubjectRead] = field(default_factory=list)
    confidence: float = 0.0
    width: int = 0
    height: int = 0
    text: str = ""


def _words(image: bytes) -> tuple[list[Word], int, int]:
    exe = shutil.which("tesseract")
    if not exe:
        return [], 0, 0
    out = subprocess.run(
        [exe, "stdin", "stdout", "--psm", "6", "tsv"], input=image, capture_output=True, timeout=90
    ).stdout.decode(errors="replace")
    words, w, h = [], 0, 0
    for r in csv.DictReader(io.StringIO(out), delimiter="\t", quoting=csv.QUOTE_NONE):
        if r.get("level") == "1":
            w, h = int(r["width"]), int(r["height"])
        text = (r.get("text") or "").strip()
        if not text or r.get("conf") in (None, "", "-1"):
            continue
        words.append(
            Word(
                text=text,
                conf=float(r["conf"]) / 100,
                left=int(r["left"]),
                top=int(r["top"]),
                width=int(r["width"]),
                height=int(r["height"]),
                line=(int(r["block_num"]), int(r["par_num"]), int(r["line_num"])),
            )
        )
    return words, w, h


NOT_SUBJECTS = re.compile(
    r"NUMBER|SUBJECTS|GRADED|RECORDED|SCHOOL|COLLEGE|EXAMINATION|CERTIFICATE|CANDIDATE|CENTRE"
)


def _looks_like_subject(text: str) -> bool:
    words = text.split()
    return (
        1 <= len(words) <= 4
        and all(len(w) >= 3 for w in words)
        and 4 <= len(text) <= 40
        and not NOT_SUBJECTS.search(text)
    )


def parse(words: list[Word], subjects: dict[str, str], width: int = 0, height: int = 0) -> SlipRead:
    """Word boxes → slip fields. `subjects` maps code → name (zimsec_subjects)."""
    # Rows by vertical position: a grade far to the right is often its own Tesseract "line".
    rows: list[list[Word]] = []
    for wd in sorted(words, key=lambda w: w.top + w.height / 2):
        mid = wd.top + wd.height / 2
        row = rows[-1] if rows else None
        if (
            row
            and abs(mid - sum(w.top + w.height / 2 for w in row) / len(row))
            < max(wd.height, row[0].height) * 0.6
        ):
            row.append(wd)
        else:
            rows.append([wd])
    lines = {i: sorted(r, key=lambda w: w.left) for i, r in enumerate(rows)}
    text = "\n".join(" ".join(w.text for w in ln) for ln in lines.values())
    up = text.upper()
    r = SlipRead(text=text, width=width, height=height)
    if re.search(r"ORDINARY\s+LEVEL|\bO[\s-]*LEVEL", up):
        r.level = "O"
    elif re.search(r"ADVANCED\s+LEVEL|\bA[\s-]*LEVEL", up):
        r.level = "A"
    if m := re.search(r"\b(NOVEMBER|JUNE)\b[^0-9]{0,12}((?:19|20)\d{2})", up):
        r.session, r.year = m[1], int(m[2])
    if m := re.search(r"CENTRE(?:\s*(?:NO|NUMBER)\.?)?\s*:?\s*(\d{6})\b", up):
        r.centre_number = m[1]
    if m := re.search(r"CANDIDATE(?:\s*(?:NO|NUMBER)\.?)?\s*:?\s*(\d{4})\b", up):
        r.candidate_number = m[1]
    if m := re.search(r"\bNAME\s*:\s*([A-Z][A-Z' -]{3,60})$", up, re.M):
        r.candidate_name = m[1].strip()
    # Certificates: "CHITESHE TAWANDA N    010655/3177" (centre/candidate after the name).
    if m := re.search(r"^[^A-Z]*([A-Z][A-Z' -]{3,60}?)\s+(\d{6})\s*/\s*(\d{4})\b", up, re.M):
        r.candidate_name = r.candidate_name or m[1].strip()
        r.centre_number = r.centre_number or m[2]
        r.candidate_number = r.candidate_number or m[3]
    grades = GRADES_A if r.level == "A" else GRADES_O
    names = {v.upper(): k for k, v in subjects.items()}
    seen: set[str] = set()
    for ln in lines.values():
        if len(ln) < 2:
            continue
        ln = [w for w in ln if re.search(r"[A-Za-z0-9€]", w.text)]  # drop specks read as punctuation
        if len(ln) < 2:
            continue
        # Certificates repeat the grade in lower case, "C (c)" or "C(c)", and stray marks follow it.
        ln = [replace(w, text=re.sub(r"^([A-Z0-9])\([a-z]\)$", r"\1", w.text)) for w in ln]
        gradeish = grades | {"8", "0", "6", "G"}
        for k in range(len(ln) - 1, max(len(ln) - 4, 0), -1):
            if ln[k].text.strip(".,:;").upper() in gradeish and len(ln[k].text.strip(".,:;")) == 1:
                ln = ln[: k + 1]
                break
        code = ln[0].text if re.fullmatch(r"\d{4}", ln[0].text) else None
        last = ln[-1]
        raw = last.text.strip(".,:;")
        body = ln[1:-1] if code else ln[:-1]
        name_text = re.sub(r"[^A-Z ]", " ", " ".join(w.text for w in body).upper()).strip()
        if not name_text or not raw or len(raw) > 2:
            continue
        name = subjects.get(code) if code else None
        if name is None and len(name_text) >= 4:
            hit = process.extractOne(name_text, list(names), scorer=fuzz.token_sort_ratio, score_cutoff=85)
            if hit:
                name, code = subjects[names[hit[0]]], names[hit[0]]
        unmatched = False
        if name is None and raw.upper() in grades and last.conf >= 0.4 and _looks_like_subject(name_text):
            # Not in the reference table (it only has some subjects): keep it, for the applicant to check.
            name, unmatched = name_text.title(), True
        if name is None or name in seen:
            continue
        seen.add(name)
        g = raw.upper()
        fixed = {"8": "B", "0": "D", "6": "C", "G": "C"}.get(g, g)
        valid = fixed in grades
        conf = last.conf if g in grades else min(last.conf, 0.5)
        if unmatched:
            conf = min(conf, 0.6)
        r.subjects.append(
            SubjectRead(
                code=code,
                name=name,
                grade=fixed if valid else None,
                confidence=round(conf, 3),
                bbox={"x": last.left, "y": last.top, "w": last.width, "h": last.height},
                read_as=None if valid and g == fixed else g,
            )
        )
    confs = [s.confidence for s in r.subjects]
    r.confidence = sum(confs) / len(confs) if confs else 0.0
    return r


def read_slip(image: bytes, mime: str, subjects: dict[str, str]) -> SlipRead:
    if mime not in READABLE:
        return SlipRead()
    words, w, h = _words(image)
    return parse(words, subjects, w, h)
