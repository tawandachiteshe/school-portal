"""Admissions review: application references, event kinds, capture device, district names

Revision ID: 0011
Revises: 0010
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # design/StaffQueue, StaffReview: "APP-27-08813", activity lines ("Assigned to C. Marufu",
    # "National ID read · phone"), "Taken on phone (Android · Chrome)".
    op.execute("""
        ALTER TABLE applications ADD COLUMN reference text UNIQUE;
        ALTER TABLE application_events
          ADD COLUMN kind text NOT NULL DEFAULT 'status'
            CHECK (kind IN ('status','note','assigned','document','identity_checked','zimsec_verified',
                            'flag_resolved','message')),
          ADD COLUMN via text CHECK (via IN ('phone','computer'));
        ALTER TABLE documents ADD COLUMN capture_device text;
        CREATE SEQUENCE application_reference_seq START 8700;
    """)


def downgrade() -> None:
    op.execute("""
        DROP SEQUENCE application_reference_seq;
        ALTER TABLE documents DROP COLUMN capture_device;
        ALTER TABLE application_events DROP COLUMN kind, DROP COLUMN via;
        ALTER TABLE applications DROP COLUMN reference;
    """)
