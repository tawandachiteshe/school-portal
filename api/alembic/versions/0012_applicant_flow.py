"""Applicant flow: programme award, offer acceptance

Revision ID: 0012
Revises: 0011
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # design/ProgrammeDesktop "HEXCO National Diploma"; design/OfferReceived "Accept by", accept/decline.
    op.execute("""
        ALTER TABLE programmes ADD COLUMN award text;
        ALTER TABLE applications
          ADD COLUMN offer_accepted_at timestamptz,
          ADD COLUMN offer_declined_at timestamptz,
          ADD CONSTRAINT offer_answered_once CHECK (offer_accepted_at IS NULL OR offer_declined_at IS NULL);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE applications DROP CONSTRAINT offer_answered_once,
          DROP COLUMN offer_accepted_at, DROP COLUMN offer_declined_at;
        ALTER TABLE programmes DROP COLUMN award;
    """)
