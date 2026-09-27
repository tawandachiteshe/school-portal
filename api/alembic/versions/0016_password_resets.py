"""Password reset by SMS code (design/ForgotPassword)

Revision ID: 0016
Revises: 0015
"""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE password_resets (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          username    text NOT NULL,              -- the Authentik username the code is for
          code_hash   bytea NOT NULL,             -- keyed hash, never the code itself
          phone       text NOT NULL,
          attempts    smallint NOT NULL DEFAULT 0,
          created_at  timestamptz NOT NULL DEFAULT now(),
          expires_at  timestamptz NOT NULL,
          used_at     timestamptz
        );
        CREATE INDEX password_resets_username ON password_resets (username, created_at DESC);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE password_resets")
