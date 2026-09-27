"""Announcement drafts, pin end, SMS text and dispatch (design/AnnouncementCompose)

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

FUNCTION = """
CREATE OR REPLACE FUNCTION announcements_for_user(p_user uuid) RETURNS SETOF announcements
LANGUAGE sql STABLE AS $$
  WITH roles AS (SELECT role FROM user_roles WHERE user_id = p_user),
       stu AS (
         SELECT s.id, s.programme_id, s.current_term_number, s.intake_id FROM students s
         JOIN people p ON p.id = s.person_id
         WHERE p.user_id = p_user AND s.status = 'active'
       ),
       my_offerings AS (
         SELECT e.offering_id FROM enrolments e JOIN stu ON stu.id = e.student_id WHERE e.dropped_at IS NULL
         UNION
         SELECT ol.offering_id FROM offering_lecturers ol
         JOIN staff st ON st.id = ol.staff_id JOIN people p ON p.id = st.person_id
         WHERE p.user_id = p_user
       ),
       my_intakes AS (
         SELECT intake_id FROM stu WHERE intake_id IS NOT NULL
         UNION
         SELECT a.intake_id FROM applications a JOIN people p ON p.id = a.person_id WHERE p.user_id = p_user
       )
  SELECT a.* FROM announcements a
  WHERE a.publish_at <= now()
    AND %s
    AND (a.expires_at IS NULL OR a.expires_at > now())
    AND EXISTS (
      SELECT 1 FROM announcement_targets t
      WHERE t.announcement_id = a.id
        AND (t.role         IS NULL OR t.role IN (SELECT role FROM roles))
        AND (t.programme_id IS NULL OR t.programme_id IN (SELECT programme_id FROM stu))
        AND (t.term_number  IS NULL OR t.term_number  IN (SELECT current_term_number FROM stu))
        AND (t.offering_id  IS NULL OR t.offering_id  IN (SELECT offering_id FROM my_offerings))
        AND (t.intake_id    IS NULL OR t.intake_id    IN (SELECT intake_id FROM my_intakes)))
$$;
"""


def upgrade() -> None:
    # Drafts are hidden from everyone but staff; a pin can end ("Until Tuesday 16 March, 16:00");
    # the optional SMS goes out once, when the announcement is dispatched (published_at reached).
    op.execute("""
        ALTER TABLE announcements
          ADD COLUMN is_draft boolean NOT NULL DEFAULT false,
          ADD COLUMN pinned_until timestamptz,
          ADD COLUMN sms_text text CHECK (sms_text IS NULL OR char_length(sms_text) <= 160),
          ADD COLUMN dispatched_at timestamptz;
        UPDATE announcements SET dispatched_at = publish_at WHERE publish_at <= now();
        CREATE INDEX announcements_undispatched ON announcements (publish_at)
          WHERE dispatched_at IS NULL AND NOT is_draft;
    """)
    op.execute(FUNCTION % "NOT a.is_draft")


def downgrade() -> None:
    op.execute(FUNCTION % "true")
    op.execute("""
        DROP INDEX announcements_undispatched;
        ALTER TABLE announcements DROP COLUMN is_draft, DROP COLUMN pinned_until,
          DROP COLUMN sms_text, DROP COLUMN dispatched_at;
    """)
