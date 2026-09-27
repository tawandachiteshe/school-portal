from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from httpx import ASGITransport, AsyncClient

from app.main import app


def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@asynccontextmanager
async def signed_in(username: str) -> AsyncIterator[AsyncClient]:
    """A client with a session for a seeded user, and the CSRF header set."""
    async with client() as c:
        await c.get("/healthz")  # receives the CSRF cookie
        c.headers["X-CSRF-Token"] = c.cookies["portal_csrf"]
        r = await c.post("/auth/dev-login", json={"username": username})
        assert r.status_code == 200, r.text
        yield c
