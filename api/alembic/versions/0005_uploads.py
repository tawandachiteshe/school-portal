"""Resumable submission uploads, accepted file types, a note to the lecturer

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE assessments
          ADD COLUMN accepted_extensions text[],               -- e.g. {'.c','.pdf'}; NULL = any
          ADD COLUMN max_file_mb smallint NOT NULL DEFAULT 20 CHECK (max_file_mb BETWEEN 1 AND 100);
        ALTER TABLE submissions ADD COLUMN student_note text;  -- "Note for Mr T. Mutasa (optional)"

        -- A file upload in progress. Chunks are stored as separate objects and joined on completion,
        -- so a dropped connection resumes from `received_bytes` (design/SubmitWork).
        CREATE TABLE upload_sessions (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          assessment_id  uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
          student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          filename       text NOT NULL,
          mime_type      text NOT NULL,
          size_bytes     integer NOT NULL CHECK (size_bytes > 0),
          received_bytes integer NOT NULL DEFAULT 0 CHECK (received_bytes BETWEEN 0 AND size_bytes),
          created_at     timestamptz NOT NULL DEFAULT now(),
          updated_at     timestamptz NOT NULL DEFAULT now(),
          completed_at   timestamptz,
          cancelled_at   timestamptz
        );
        CREATE INDEX ON upload_sessions (student_id, assessment_id)
          WHERE completed_at IS NULL AND cancelled_at IS NULL;
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE upload_sessions;
        ALTER TABLE submissions DROP COLUMN student_note;
        ALTER TABLE assessments DROP COLUMN accepted_extensions, DROP COLUMN max_file_mb;
    """)
