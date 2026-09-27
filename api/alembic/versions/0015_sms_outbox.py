"""SMS outbox for texts that aren't portal notifications: Authentik's sign-up and reset codes

Revision ID: 0015
Revises: 0014
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE sms_outbox (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          to_phone    text NOT NULL CHECK (to_phone ~ '^\\+[1-9][0-9]{7,14}$'),
          body        text NOT NULL,
          purpose     text NOT NULL,          -- 'authentik' (verification or reset code)
          status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
          provider_ref text,
          error       text,
          created_at  timestamptz NOT NULL DEFAULT now(),
          sent_at     timestamptz
        );
        CREATE INDEX sms_outbox_queued ON sms_outbox (created_at) WHERE status = 'queued';
    """)


def downgrade() -> None:
    op.execute("DROP TABLE sms_outbox")
