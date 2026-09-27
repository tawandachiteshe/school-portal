from fastapi import FastAPI

from app.api import (
    admissions,
    admissions_places,
    announcements_staff,
    apply,
    apply_birth,
    apply_id,
    apply_results,
    apply_review,
    apply_submit,
    ask_questions_staff,
    assistant,
    deadlines,
    internal,
    library,
    library_catalogue,
    library_desk,
    me,
    modules,
    public,
    records,
    student,
    students_staff,
    teaching,
)
from app.auth import reset as auth_reset
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
        # operationId = the route function's name, so generated web hooks read well (useDashboard).
        # (Included routes arrive as a route context, not an APIRoute, so read `name` loosely.)
        generate_unique_id_function=lambda route: getattr(route, "name", None) or route.path,
    )
    app.add_middleware(CSRFMiddleware)

    @app.get("/healthz", tags=["ops"])
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_routes.router)
    app.include_router(auth_reset.router)
    app.include_router(me.router)
    app.include_router(student.router)
    app.include_router(library.router)
    app.include_router(modules.router)
    app.include_router(deadlines.router)
    app.include_router(records.router)
    app.include_router(teaching.router)
    app.include_router(library_desk.router)
    app.include_router(announcements_staff.router)
    app.include_router(admissions.router)
    app.include_router(apply.router)
    app.include_router(apply_id.router)
    app.include_router(apply_birth.router)
    app.include_router(apply_results.router)
    app.include_router(apply_review.router)
    app.include_router(apply_submit.router)
    app.include_router(apply_submit.staff_router)
    app.include_router(internal.router)
    app.include_router(public.router)
    app.include_router(admissions_places.router)
    app.include_router(library_catalogue.router)
    app.include_router(students_staff.router)
    app.include_router(assistant.router)
    app.include_router(ask_questions_staff.router)
    return app


app = create_app()
