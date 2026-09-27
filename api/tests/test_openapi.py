from app.openapi_export import DEFAULT, spec_json


def test_committed_spec_is_current():
    """web/openapi.json drives the generated web client. Regenerate with: cd web && bun run gen:api"""
    assert DEFAULT.read_text() == spec_json(), "OpenAPI spec is stale: run `bun run gen:api` in web/"


def test_operation_ids_are_unique():
    from app.main import app

    ids = [op["operationId"] for path in app.openapi()["paths"].values() for op in path.values()]
    assert len(ids) == len(set(ids))


def test_response_model_names_are_unique():
    """Two models with one name make FastAPI emit "app__api__…" schemas and Orval renames the types."""
    from app.main import app

    clashes = [name for name in app.openapi()["components"]["schemas"] if "__" in name]
    assert clashes == [], f"Rename these models: {clashes}"
