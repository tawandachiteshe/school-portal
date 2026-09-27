"""Who downloaded which note (design/LecturerHome "Downloaded by 24/79")

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE material_downloads (
          material_id  uuid NOT NULL REFERENCES course_materials(id) ON DELETE CASCADE,
          user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          first_at     timestamptz NOT NULL DEFAULT now(),
          last_at      timestamptz NOT NULL DEFAULT now(),
          count        integer NOT NULL DEFAULT 1,
          PRIMARY KEY (material_id, user_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE material_downloads")
