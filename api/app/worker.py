"""Celery worker and beat: background jobs that must run on time without a request.

Run: `celery -A app.worker worker -B --loglevel=info` (compose service `worker`).
"""

import asyncio

from celery import Celery
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.services import announcements

app = Celery("tcfl", broker=get_settings().redis_url)
app.conf.timezone = "Africa/Harare"
app.conf.beat_schedule = {
    # Scheduled announcements notify their audience (and queue SMS) when their time comes.
    "dispatch-announcements": {"task": "app.worker.dispatch_announcements", "schedule": 60.0},
}


async def _dispatch() -> int:
    # Each task runs in a fresh event loop, so no pooled connections.
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            return await announcements.dispatch_due(db)
    finally:
        await engine.dispose()


@app.task
def dispatch_announcements() -> int:
    return asyncio.run(_dispatch())
