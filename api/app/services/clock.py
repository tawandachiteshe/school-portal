from datetime import date, datetime, time
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.config import get_settings


@lru_cache
def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def now() -> datetime:
    return datetime.now(tz())


def today() -> date:
    return now().date()


def at(d: date, t: time) -> datetime:
    """A local wall-clock time on a date, as an aware datetime (timetable slots are local times)."""
    return datetime.combine(d, t, tzinfo=tz())
