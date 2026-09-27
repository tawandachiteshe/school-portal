"""Double-submit CSRF protection (docs/10 §10.6). The session cookie is SameSite=Lax; state-changing
requests must also echo the readable `portal_csrf` cookie in an X-CSRF-Token header."""

import hmac

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings
from app.crypto import random_token

COOKIE = "portal_csrf"
HEADER = "x-csrf-token"
SAFE = {"GET", "HEAD", "OPTIONS"}
# Server-to-server endpoints authenticate with their own secret.
EXEMPT_PREFIXES = ("/internal/",)


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        cookie = request.cookies.get(COOKIE)
        if request.method not in SAFE and not request.url.path.startswith(EXEMPT_PREFIXES):
            header = request.headers.get(HEADER, "")
            if not cookie or not hmac.compare_digest(cookie, header):
                return JSONResponse({"detail": "Refresh the page and try again."}, status_code=403)
        response = await call_next(request)
        if not cookie:
            response.set_cookie(
                COOKIE, random_token(24), samesite="lax", secure=get_settings().is_prod, path="/"
            )
        return response
