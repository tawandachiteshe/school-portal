"""API tests run against a real Postgres (the schema relies on enums, citext, pgvector).

TEST_DATABASE_URL defaults to a `portal_test` database next to the dev one; it is dropped,
migrated and seeded once per test run.
"""

import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import psycopg
import pytest
from sqlalchemy.engine import make_url

from app.config import get_settings

API_DIR = Path(__file__).resolve().parent.parent


def _test_url() -> str:
    if url := os.environ.get("TEST_DATABASE_URL"):
        return url
    dev = make_url(get_settings().database_url)
    return dev.set(database="portal_test").render_as_string(hide_password=False)


TEST_URL = _test_url()
os.environ["DATABASE_URL"] = TEST_URL
os.environ["APP_ENV"] = "test"
get_settings.cache_clear()


def _recreate_database() -> None:
    url = make_url(TEST_URL)
    admin = url.set(drivername="postgresql", database="postgres").render_as_string(hide_password=False)
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{url.database}"')


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    _recreate_database()
    env = {**os.environ, "DATABASE_URL": TEST_URL}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=API_DIR, env=env, check=True)
    subprocess.run([sys.executable, "-m", "app.seed"], cwd=API_DIR, env=env, check=True, capture_output=True)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def today() -> date:
    return date.today()
