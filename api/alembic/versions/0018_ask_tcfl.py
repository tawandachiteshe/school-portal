"""Ask TCFL: questions handed to Student Affairs (design/AskHandoff)

Revision ID: 0018
Revises: 0017

chat_sessions and chat_messages are in 0001. A question the assistant can't answer is sent to
Student Affairs only when the student presses "Send to Student Affairs"; the assistant can't send it.
"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE SEQUENCE ask_question_seq;
        CREATE TABLE ask_questions (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          reference      text NOT NULL UNIQUE,                    -- 'SA-0311-027'
          user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          chat_session_id uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
          question       text NOT NULL CHECK (length(question) BETWEEN 3 AND 2000),
          reply          text,
          replied_by     uuid REFERENCES users(id) ON DELETE SET NULL,
          replied_at     timestamptz,
          created_at     timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ask_questions_open ON ask_questions (created_at) WHERE replied_at IS NULL;
        CREATE INDEX ask_questions_user ON ask_questions (user_id, created_at DESC);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE ask_questions; DROP SEQUENCE ask_question_seq;")
