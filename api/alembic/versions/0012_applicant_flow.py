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
        -- Withdrawing and applying again to the same programme is allowed.
        ALTER TABLE applications DROP CONSTRAINT applications_person_id_intake_id_programme_id_key;
        CREATE UNIQUE INDEX applications_one_per_programme
          ON applications (person_id, intake_id, programme_id)
          WHERE status <> 'withdrawn';
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX applications_one_per_programme;
        ALTER TABLE applications ADD CONSTRAINT applications_person_id_intake_id_programme_id_key
          UNIQUE (person_id, intake_id, programme_id);
        ALTER TABLE applications DROP CONSTRAINT offer_answered_once,
          DROP COLUMN offer_accepted_at, DROP COLUMN offer_declined_at;
        ALTER TABLE programmes DROP COLUMN award;
    """)
