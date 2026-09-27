"""Intake places: how many places each programme has in an intake (staff/admissions/places)

Revision ID: 0019
Revises: 0018
"""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE intake_places (
          intake_id    uuid NOT NULL REFERENCES intakes(id) ON DELETE CASCADE,
          programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
          places       integer NOT NULL CHECK (places >= 0),
          updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
          updated_at   timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (intake_id, programme_id)
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE intake_places")
