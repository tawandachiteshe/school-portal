from fastapi import FastAPI

from app.api import deadlines, library, me, modules, student
from app.auth import routes as auth_routes
from app.auth.csrf import CSRFMiddleware
from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    # Routes are mounted at the root; the browser reaches them under /api via the
    # Vite dev proxy or Traefik (docs/06 §6.3).
    app = FastAPI(
        title="TCFL Portal API",
        version="0.1.0",
        docs_url=None if settings.is_prod else "/docs",
    )
    app.add_middleware(CSRFMiddleware)

    @app.get("/healthz", tags=["ops"])
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_routes.router)
    app.include_router(me.router)
    app.include_router(student.router)
    app.include_router(library.router)
    app.include_router(modules.router)
    app.include_router(deadlines.router)
    return app


app = create_app()
