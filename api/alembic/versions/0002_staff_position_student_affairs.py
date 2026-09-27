"""Student Affairs role; staff job title shown in the staff sidebar

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Student Affairs staff write announcements and answer Ask TCFL hand-offs (design/AnnouncementCompose).
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'student_affairs'")
    # e.g. 'Admissions officer', 'Lecturer · Data Communications', 'Librarian · Block A desk'
    op.execute("ALTER TABLE staff ADD COLUMN position text")


def downgrade() -> None:
    op.execute("ALTER TABLE staff DROP COLUMN position")
