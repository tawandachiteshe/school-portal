"""Generate a draw.io ER diagram from the live database.

    uv run python scripts/erd_drawio.py            # writes ../docs/database/erd.drawio

One page per domain (tables from other domains appear as grey stubs) plus an "All tables" page.
Each column is a row with key (PK / FK / UK), name and type; FK lines run from the FK column to the
referenced table. Tables are laid out left to right by foreign-key depth: referenced tables on the left.
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

ROW, HEAD, KEY_W, GAP_X, GAP_Y, CHAR = 24, 32, 52, 120, 40, 7.2
HEADER_FILL, NEW_FILL, STUB_FILL = "#EAF1F9", "#E8F3EC", "#F1EFEB"
LINE, MUTED, TEXT = "#C4BFB6", "#8C867C", "#1F1D1A"
MONO = "fontFamily=IBM Plex Mono;"
EDGE_COLOURS = ["#2F6FB3", "#B35A2F", "#2F8F5B", "#7A5AA6", "#A6862F", "#2F8F8F", "#A63F5A", "#5A6B7A"]


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


def type_label(typ: str, nullable: bool, pk: bool) -> str:
    if nullable or pk:
        return html.escape(typ)
    return f'{html.escape(typ)} <font color="{MUTED}">not null</font>'


class Page:
    def __init__(self, name: str):
        self.name = name
        self.cells: list[str] = []
        self.ids: dict[tuple[str, str | None], str] = {}
        self.n = 2
        self.edges = 0

    def nid(self) -> str:
        self.n += 1
        return f"c{self.n}"

    @staticmethod
    def rows(t, cols, keys, stub=False):
        rows = [c for c in cols[t] if not stub or "PK" in keys.get((t, c[0]), set())]

        # Primary key first, then foreign keys, then the rest, each in table order.
        def rank(c):
            k = keys.get((t, c[0]), set())
            return 0 if "PK" in k else 1 if "FK" in k else 2

        return sorted(rows, key=rank)

    @classmethod
    def size(cls, t, cols, keys, stub=False):
        rows = cls.rows(t, cols, keys, stub)
        name_w = max(len(c) for c, _t, _n in rows) * CHAR + 24
        type_w = max(len(typ) + (0 if n else 9) for _c, typ, n in rows) * CHAR + 24
        title = t + (" (other domain)" if stub else "")
        w = max(KEY_W + name_w + type_w, len(title) * 8 + 32)
        return w, name_w, HEAD + ROW * len(rows)

    def table(self, t, cols, keys, x, y, stub=False):
        rows = self.rows(t, cols, keys, stub)
        w, name_w, h = self.size(t, cols, keys, stub)
        type_w = w - KEY_W - name_w
        tid = self.nid()
        self.ids[(t, None)] = tid
        fill = STUB_FILL if stub else (NEW_FILL if t in NEW_TABLES else HEADER_FILL)
        style = (
            "shape=table;startSize=32;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;"
            f"rowLines=0;columnLines=0;fontStyle=1;align=center;resizeLast=1;html=1;fillColor={fill};swimlaneFillColor=#FFFFFF;"
            f"strokeColor={LINE};fontColor={TEXT};fontFamily=IBM Plex Sans;fontSize=13;"
        )
        label = t + (" (other domain)" if stub else "")
        self.cells.append(
            f'<mxCell id="{tid}" value="{html.escape(label)}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        last_pk = max(
            (i for i, (c, _t, _n) in enumerate(rows) if "PK" in keys.get((t, c), set())), default=-1
        )
        for i, (c, typ, nullable) in enumerate(rows):
            k = sorted(keys.get((t, c), set()), key=["PK", "FK", "UK"].index)
            new = (t, c) in NEW_COLUMNS
            rid = self.nid()
            self.ids[(t, c)] = rid
            fill_row = NEW_FILL if new else "none"
            self.cells.append(
                f'<mxCell id="{rid}" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;'
                f"swimlaneBody=0;fillColor={fill_row};collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];"
                f"portConstraint=eastwest;top=0;left=0;right=0;bottom={1 if i == last_pk else 0};"
                f'strokeColor={LINE};html=1;" vertex="1" parent="{tid}">'
                f'<mxGeometry y="{HEAD + i * ROW}" width="{w}" height="{ROW}" as="geometry"/></mxCell>'
            )
            weight = "fontStyle=1;" if "PK" in k else ""
            cell = (
                "shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;"
                "overflow=hidden;whiteSpace=nowrap;html=1;verticalAlign=middle;fontSize=11;"
            )
            parts = [
                (",".join(k), KEY_W, f"align=center;fontFamily=IBM Plex Sans;fontColor={MUTED};fontStyle=1;"),
                (html.escape(c), name_w, f"align=left;spacingLeft=8;{MONO}fontColor={TEXT};{weight}"),
                (type_label(typ, nullable, "PK" in k), type_w,
                 f"align=left;spacingLeft=8;{MONO}fontColor={MUTED};"),
            ]  # fmt: skip
            cx = 0
            for value, cw, extra in parts:
                self.cells.append(
                    f'<mxCell id="{self.nid()}" value="{html.escape(value)}" style="{cell}{extra}" '
                    f'vertex="1" parent="{rid}">'
                    f'<mxGeometry x="{cx}" width="{cw}" height="{ROW}" as="geometry">'
                    f'<mxRectangle width="{cw}" height="{ROW}" as="alternateBounds"/></mxGeometry></mxCell>'
                )
                cx += cw
        return h

    def edge(self, src_t, src_c, dst_t, nullable):
        s = self.ids.get((src_t, src_c)) or self.ids.get((src_t, None))
        d = self.ids.get((dst_t, "id")) or self.ids.get((dst_t, None))
        if not s or not d:
            return
        colour = EDGE_COLOURS[self.edges % len(EDGE_COLOURS)]
        self.edges += 1
        end = "ERzeroToOne" if nullable else "ERmandOne"
        style = (
            f"edgeStyle=entityRelationEdgeStyle;html=1;endArrow={end};startArrow=ERmany;rounded=1;"
            f"strokeColor={colour};strokeWidth=1.5;endFill=0;startFill=0;endSize=10;startSize=10;"
            "jumpStyle=arc;jumpSize=8;"
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


def layers(tables, refs):
    """Referenced tables to the left, referencing tables to the right (longest path from a root)."""
    depth: dict[str, int] = {}

    def visit(t, seen):
        if t in depth:
            return depth[t]
        parents = [p for p in refs.get(t, ()) if p != t and p not in seen]
        depth[t] = 1 + max((visit(p, seen | {t}) for p in parents), default=-1)
        return depth[t]

    for t in tables:
        visit(t, frozenset())
    # Tables nothing points from (roots) sit just left of the nearest table that references them.
    for t in tables:
        if depth[t] == 0:
            children = [c for c in tables if c != t and t in refs.get(c, ())]
            if children:
                depth[t] = max(0, min(depth[c] for c in children) - 1)
    cols: dict[int, list[str]] = defaultdict(list)
    for t in tables:
        cols[depth[t]].append(t)
    ordered = [cols[i] for i in sorted(cols)]
    # Order each layer by the mean position of the tables it points at, so lines stay short.
    pos: dict[str, float] = {}
    for layer in ordered:
        layer.sort(
            key=lambda t: (
                sum(pos[p] for p in refs.get(t, ()) if p in pos)
                / max(1, sum(1 for p in refs.get(t, ()) if p in pos))
                if any(p in pos for p in refs.get(t, ()))
                else 1e9
            )
        )
        pos.update({t: i for i, t in enumerate(layer)})
    return ordered


def build_page(name, tables, cols, keys, fks, with_stubs=True, max_rows=None):
    page = Page(name)
    nullable = {(t, c): n for t, rows in cols.items() for c, _typ, n in rows}
    in_page = set(tables)
    stubs = (
        sorted({dt for st, _sc, dt, _dc in fks if st in in_page and dt not in in_page}) if with_stubs else []
    )
    shown = [*tables, *stubs]
    refs: dict[str, set[str]] = defaultdict(set)
    for st, _sc, dt, _dc in fks:
        if st in in_page and dt in shown:
            refs[st].add(dt)
    x = 0
    for layer in layers(shown, refs):
        # Very tall layers wrap into several columns.
        chunks, cur, height = [], [], 0
        for t in layer:
            h = Page.size(t, cols, keys, t in stubs)[2]
            if max_rows and cur and height + h > max_rows:
                chunks.append(cur)
                cur, height = [], 0
            cur.append(t)
            height += h + GAP_Y
        chunks.append(cur)
        for chunk in chunks:
            y, width = 0, 0
            for t in chunk:
                h = page.table(t, cols, keys, x, y, stub=t in stubs)
                width = max(width, Page.size(t, cols, keys, t in stubs)[0])
                y += h + GAP_Y
            x += width + GAP_X
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
    pages.append(build_page("All tables", everything, cols, keys, fks, with_stubs=False, max_rows=2400))
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
