"""Accounts role: confirms bank and cash application fees (design/PayOffice "once Accounts confirm")

Revision ID: 0014
Revises: 0013
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'accounts'")


def downgrade() -> None:
    pass  # enum values can't be dropped; unused, it does no harm
