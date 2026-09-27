"""Announcement sender label, contact line and "affects you" fields

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # design/Main, AnnouncementDetail: "ICT Services · Today, 07:15", "Questions: ICT Services, Block C",
    # and "None of your classes are in Lab 3 on Friday." (computed from affects_venue_id + affects_on).
    op.execute("""
        ALTER TABLE announcements
          ADD COLUMN from_label text,
          ADD COLUMN contact_line text,
          ADD COLUMN affects_venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
          ADD COLUMN affects_on date
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE announcements
          DROP COLUMN from_label, DROP COLUMN contact_line,
          DROP COLUMN affects_venue_id, DROP COLUMN affects_on
    """)
