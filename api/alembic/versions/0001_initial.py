"""Initial schema, matching docs/database/schema.sql

Revision ID: 0001
Revises:
"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SQL = Path(__file__).resolve().parent.parent / "sql" / "0001_initial.sql"


def upgrade() -> None:
    # Run the script through the DBAPI cursor: it has $$ function bodies and
    # colons that SQLAlchemy's text() would treat as bind parameters.
    op.get_bind().connection.dbapi_connection.cursor().execute(SQL.read_text())


def downgrade() -> None:
    op.execute("DROP SCHEMA public CASCADE")
    op.execute("CREATE SCHEMA public")
