"""A database session that can only read: every transaction on these connections is read-only
(Postgres default_transaction_read_only), so INSERT, UPDATE or DELETE raise, whatever the code does."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings


@lru_cache
def _engine() -> AsyncEngine:
    s = get_settings()
    return create_async_engine(
        s.database_url,
        # Its own pool, never shared with sessions that write.
        poolclass=NullPool if s.app_env == "test" else None,
        pool_pre_ping=s.app_env != "test",
        connect_args={"options": "-c default_transaction_read_only=on -c statement_timeout=5000"},
    )


@asynccontextmanager
async def read_only_session() -> AsyncIterator[AsyncSession]:
    async with async_sessionmaker(_engine(), expire_on_commit=False)() as db:
        yield db
