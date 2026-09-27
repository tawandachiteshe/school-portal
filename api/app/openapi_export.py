"""Write the OpenAPI spec the web client is generated from (Orval, web/orval.config.ts).

uv run python -m app.openapi_export            # writes ../web/openapi.json
"""

import json
import sys
from pathlib import Path

from app.main import app

DEFAULT = Path(__file__).resolve().parents[2] / "web" / "openapi.json"


def spec_json() -> str:
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    out.write_text(spec_json())
    print(f"Wrote {out}")
