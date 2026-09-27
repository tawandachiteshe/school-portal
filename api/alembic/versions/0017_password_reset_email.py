"""Password reset codes can go by email too

Revision ID: 0017
Revises: 0016
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE password_resets ALTER COLUMN phone DROP NOT NULL;
        ALTER TABLE password_resets ADD COLUMN email text;   -- where the code was emailed, if anywhere
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE password_resets DROP COLUMN email;
        DELETE FROM password_resets WHERE phone IS NULL;
        ALTER TABLE password_resets ALTER COLUMN phone SET NOT NULL;
    """)
