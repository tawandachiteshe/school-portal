"""Teaching: class sessions and attendance (the register), absences and marks-due dates

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        -- One meeting of a class (a timetable slot on a date). Created when the register is opened.
        CREATE TABLE class_sessions (
          id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          offering_id       uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
          slot_id           uuid REFERENCES timetable_slots(id) ON DELETE SET NULL,
          on_date           date NOT NULL,
          starts_at         timestamptz NOT NULL,
          ends_at           timestamptz NOT NULL,
          venue_id          uuid REFERENCES venues(id),
          register_taken_at timestamptz,                        -- "Finish register"
          taken_by          uuid REFERENCES users(id),
          created_at        timestamptz NOT NULL DEFAULT now(),
          UNIQUE (slot_id, on_date)
        );
        CREATE INDEX ON class_sessions (offering_id, on_date);

        -- design/Register: Present · Late · Absent, saved on every tap.
        CREATE TABLE attendance (
          session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
          student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          status     text NOT NULL CHECK (status IN ('present','late','absent')),
          marked_at  timestamptz NOT NULL DEFAULT now(),
          marked_by  uuid REFERENCES users(id),
          PRIMARY KEY (session_id, student_id)
        );

        -- design/LecturerMarks: "Absent · Medical note received"
        ALTER TABLE submissions
          ADD COLUMN is_absent boolean NOT NULL DEFAULT false,
          ADD COLUMN absence_note text;

        -- design/LecturerHome: "marks due Thu 25 Mar", "results due to students Fri 12 Mar"
        ALTER TABLE assessments ADD COLUMN marks_due_on date;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE assessments DROP COLUMN marks_due_on;
        ALTER TABLE submissions DROP COLUMN is_absent, DROP COLUMN absence_note;
        DROP TABLE attendance;
        DROP TABLE class_sessions;
    """)
