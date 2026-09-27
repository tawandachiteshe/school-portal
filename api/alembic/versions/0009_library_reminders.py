"""Overdue reminders on library loans (design/LibraryOverdue "Last reminder")

Revision ID: 0009
Revises: 0008
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE library_loans
          ADD COLUMN last_reminder_at timestamptz,
          ADD COLUMN last_reminder_channel text CHECK (last_reminder_channel IN ('sms','in_app','email')),
          ADD COLUMN issued_by uuid REFERENCES users(id),
          ADD COLUMN returned_to uuid REFERENCES users(id);
        CREATE INDEX library_loans_due_open ON library_loans (due_at) WHERE returned_at IS NULL;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX library_loans_due_open;
        ALTER TABLE library_loans DROP COLUMN last_reminder_at, DROP COLUMN last_reminder_channel,
          DROP COLUMN issued_by, DROP COLUMN returned_to;
    """)
