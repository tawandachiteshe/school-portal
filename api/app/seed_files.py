"""Small, valid PDFs for seeded course notes, padded to the sizes shown in the designs."""


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(title: str, lines: list[str], size: int = 0) -> bytes:
    """A one-page A4 PDF with a title and lines of text. `size` pads it with an unused stream."""
    content = ["BT", "/F1 20 Tf", "72 770 Td", f"({_esc(title)}) Tj", "/F1 12 Tf", "0 -32 Td"]
    for line in lines:
        content += [f"({_esc(line)}) Tj", "0 -18 Td"]
    content.append("ET")
    stream = "\n".join(content).encode("latin-1", "replace")

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    def build(padding: int) -> bytes:
        parts = list(objs)
        if padding > 0:
            filler = b"0" * padding
            parts.append(b"<< /Length %d >>\nstream\n" % len(filler) + filler + b"\nendstream")
        out = bytearray(b"%PDF-1.4\n")
        offsets = []
        for i, body in enumerate(parts, start=1):
            offsets.append(len(out))
            out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
        xref = len(out)
        out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(parts) + 1)
        for off in offsets:
            out += b"%010d 00000 n \n" % off
        out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(parts) + 1, xref)
        return bytes(out)

    base = len(build(0))
    overhead = len(build(1)) - base - 1  # bytes the filler object adds besides the filler itself
    if size <= base + overhead + 1:
        return build(0)
    pdf = build(size - base - overhead)
    # The digit count of /Length and offsets can shift a byte or two; nudge to the exact size.
    return build(size - base - overhead - (len(pdf) - size))
