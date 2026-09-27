"""Generate a draw.io ER diagram from the live database.

    uv run python scripts/erd_drawio.py            # writes ../docs/database/erd.drawio

One page per domain (tables from other domains appear as grey stubs) plus an "All tables" page.
Each column is a row marked PK / FK / UK; FK lines run from the FK column to the referenced table.
"""

import html
import sys
from collections import defaultdict
from pathlib import Path

import psycopg
from sqlalchemy.engine import make_url

from app.config import get_settings

OUT = Path(__file__).resolve().parents[2] / "docs" / "database" / "erd.drawio"

DOMAINS: dict[str, list[str]] = {
    "Identity and people": [
        "users", "user_roles", "web_sessions", "idp_events", "people", "staff", "students",
    ],
    "Academic structure": [
        "departments", "programmes", "grading_scales", "grading_bands", "modules", "programme_modules",
        "academic_terms", "intakes", "venues", "module_offerings", "offering_lecturers", "enrolments",
        "timetable_slots", "timetable_exceptions",
    ],
    "Assessment and results": [
        "assessments", "submissions", "submission_files", "upload_sessions", "module_results",
        "remark_requests", "attachments",
    ],
    "Onboarding": [
        "applications", "application_events", "device_handoffs", "documents", "document_fields",
        "exam_sittings", "exam_subject_results", "application_flags", "zimsec_verification_batches",
        "zimsec_verification_items", "district_codes", "zimsec_subjects",
    ],
    "Notes and announcements": [
        "course_materials", "material_downloads", "announcements", "announcement_targets",
        "announcement_reads",
    ],
    "Library": [
        "library_items", "library_copies", "library_loans", "library_reservations", "reading_list_items",
        "library_pages",
    ],
    "Fees": ["fee_transactions", "fee_due_dates"],
    "Assistant and notifications": [
        "kb_documents", "kb_chunks", "chat_sessions", "chat_messages", "notification_preferences",
        "push_subscriptions", "notifications", "notification_deliveries",
    ],
    "Compliance and operations": ["audit_log", "data_subject_requests", "retention_runs", "import_runs"],
}  # fmt: skip

# Columns added after docs/database/schema.sql (migrations 0002–0007) are highlighted.
NEW_TABLES = {
    "material_downloads", "upload_sessions", "fee_transactions", "fee_due_dates", "remark_requests",
    "library_reservations", "reading_list_items",
}  # fmt: skip
NEW_COLUMNS = {
    ("staff", "position"), ("announcements", "from_label"), ("announcements", "contact_line"),
    ("announcements", "affects_venue_id"), ("announcements", "affects_on"),
    ("assessments", "accepted_extensions"), ("assessments", "max_file_mb"), ("submissions", "student_note"),
    ("library_items", "edition"),
}  # fmt: skip

W, ROW, HEAD, GAP_X, GAP_Y, COLS = 280, 22, 30, 80, 60, 4
HEADER_FILL, NEW_FILL, STUB_FILL = "#EAF1F9", "#E8F3EC", "#F1EFEB"


def load(conn):
    cols: dict[str, list[tuple[str, str, bool]]] = defaultdict(list)
    for t, c, typ, udt, nullable in conn.execute(
        """SELECT table_name, column_name, data_type, udt_name, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name NOT IN ('alembic_version', 'audit_log_default')
             AND table_name IN (SELECT table_name FROM information_schema.tables
                                WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
           ORDER BY table_name, ordinal_position"""
    ):
        shown = udt if typ in ("USER-DEFINED", "ARRAY") else typ
        shown = shown.lstrip("_") + "[]" if typ == "ARRAY" else shown
        shown = shown.replace("timestamp with time zone", "timestamptz").replace(
            "character varying", "varchar"
        )
        shown = shown.replace("character", "char").replace("time without time zone", "time")
        cols[t].append((c, shown, nullable == "YES"))

    keys: dict[tuple[str, str], set[str]] = defaultdict(set)
    for t, c, kind in conn.execute(
        """SELECT tc.table_name, kcu.column_name, tc.constraint_type
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
           WHERE tc.table_schema = 'public'
             AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')"""
    ):
        keys[(t, c)].add({"PRIMARY KEY": "PK", "UNIQUE": "UK", "FOREIGN KEY": "FK"}[kind])

    fks = conn.execute(
        """SELECT DISTINCT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
           ORDER BY 1, 2"""
    ).fetchall()
    return cols, keys, fks


class Page:
    def __init__(self, name: str):
        self.name = name
        self.cells: list[str] = []
        self.ids: dict[tuple[str, str | None], str] = {}
        self.n = 2

    def nid(self) -> str:
        self.n += 1
        return f"c{self.n}"

    def table(self, t, cols, keys, x, y, stub=False):
        rows = [c for c in cols[t] if not stub or keys.get((t, c[0]), set()) & {"PK"}]
        tid = self.nid()
        self.ids[(t, None)] = tid
        fill = STUB_FILL if stub else (NEW_FILL if t in NEW_TABLES else HEADER_FILL)
        h = HEAD + ROW * len(rows)
        style = (
            "swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=30;horizontalStack=0;"
            f"resizeParent=1;resizeLast=0;collapsible=1;marginBottom=0;fillColor={fill};strokeColor=#C4BFB6;"
            "fontFamily=IBM Plex Sans;fontSize=13;rounded=0;"
        )
        label = t + (" (other domain)" if stub else "")
        self.cells.append(
            f'<mxCell id="{tid}" value="{html.escape(label)}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{W}" height="{h}" as="geometry"/></mxCell>'
        )
        for i, (c, typ, nullable) in enumerate(rows):
            k = sorted(keys.get((t, c), set()), key=["PK", "FK", "UK"].index)
            mark = ",".join(k)
            new = (t, c) in NEW_COLUMNS
            text = f"{mark + ' ' if mark else ''}{c}: {typ}{'' if nullable or 'PK' in k else ' NOT NULL'}"
            rid = self.nid()
            self.ids[(t, c)] = rid
            rstyle = (
                "text;strokeColor=none;align=left;verticalAlign=middle;spacingLeft=8;spacingRight=4;overflow=hidden;"
                "rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;"
                "fontFamily=IBM Plex Mono;fontSize=11;"
                + ("fontStyle=1;" if "PK" in k else "")
                + (f"fillColor={NEW_FILL};" if new else "fillColor=none;")
            )
            self.cells.append(
                f'<mxCell id="{rid}" value="{html.escape(text)}" style="{rstyle}" vertex="1" parent="{tid}">'
                f'<mxGeometry y="{HEAD + i * ROW}" width="{W}" height="{ROW}" as="geometry"/></mxCell>'
            )
        return h

    def edge(self, src_t, src_c, dst_t, nullable):
        s = self.ids.get((src_t, src_c)) or self.ids.get((src_t, None))
        d = self.ids.get((dst_t, "id")) or self.ids.get((dst_t, None))
        if not s or not d:
            return
        end = "ERzeroToOne" if nullable else "ERmandOne"
        style = (
            "edgeStyle=entityRelationEdgeStyle;fontSize=11;html=1;endArrow="
            f"{end};startArrow=ERmany;rounded=0;strokeColor=#8C867C;endFill=0;startFill=0;"
        )
        self.cells.append(
            f'<mxCell id="{self.nid()}" style="{style}" edge="1" parent="1" source="{s}" target="{d}">'
            '<mxGeometry relative="1" as="geometry"/></mxCell>'
        )

    def xml(self, idx: int) -> str:
        body = "".join(self.cells)
        return (
            f'<diagram id="p{idx}" name="{html.escape(self.name)}"><mxGraphModel dx="1400" dy="900" grid="1" '
            'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" '
            'math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
            f"{body}</root></mxGraphModel></diagram>"
        )


def build_page(name, tables, cols, keys, fks, with_stubs=True):
    page = Page(name)
    nullable = {(t, c): n for t, rows in cols.items() for c, _typ, n in rows}
    in_page = set(tables)
    stubs = (
        sorted({dt for st, _sc, dt, _dc in fks if st in in_page and dt not in in_page}) if with_stubs else []
    )
    x = y = 0
    col_heights = [0] * COLS
    for i, t in enumerate([*tables, *stubs]):
        col = min(range(COLS), key=lambda k: col_heights[k]) if i >= COLS else i % COLS
        x = col * (W + GAP_X)
        y = col_heights[col]
        h = page.table(t, cols, keys, x, y, stub=t in stubs)
        col_heights[col] = y + h + GAP_Y
    for st, sc, dt, _dc in fks:
        if st in in_page:
            page.edge(st, sc, dt, nullable.get((st, sc), True))
    return page


def main() -> None:
    url = (
        make_url(get_settings().database_url)
        .set(drivername="postgresql")
        .render_as_string(hide_password=False)
    )
    with psycopg.connect(url) as conn:
        cols, keys, fks = load(conn)
    everything = [t for ts in DOMAINS.values() for t in ts]
    missing = sorted(set(cols) - set(everything))
    if missing:
        sys.exit(f"Tables not assigned to a domain: {', '.join(missing)}")
    pages = [build_page(name, ts, cols, keys, fks) for name, ts in DOMAINS.items()]
    pages.append(build_page("All tables", everything, cols, keys, fks, with_stubs=False))
    xml = (
        '<mxfile host="tcfl-portal" type="device">'
        + "".join(p.xml(i) for i, p in enumerate(pages))
        + "</mxfile>\n"
    )
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    out.write_text(xml)
    print(f"Wrote {out}: {len(cols)} tables, {len(fks)} foreign keys, {len(pages)} pages")


if __name__ == "__main__":
    main()
