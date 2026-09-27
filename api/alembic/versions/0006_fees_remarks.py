"""Fee statement, payment due dates and re-mark requests

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        -- Synced from the finance system (design/Fees). Charges are positive, payments negative.
        CREATE TABLE fee_transactions (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id   uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          term_id      uuid REFERENCES academic_terms(id),
          kind         text NOT NULL CHECK (kind IN ('charge','payment','adjustment')),
          description  text NOT NULL,
          amount       numeric(10,2) NOT NULL,
          currency     char(3) NOT NULL DEFAULT 'USD',
          occurred_on  date NOT NULL,
          receipt_ref  text,
          external_id  text UNIQUE,
          created_at   timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ON fee_transactions (student_id, occurred_on);

        CREATE TABLE fee_due_dates (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          term_id     uuid REFERENCES academic_terms(id),
          label       text NOT NULL,                        -- 'Second instalment'
          amount      numeric(10,2) NOT NULL CHECK (amount > 0),
          currency    char(3) NOT NULL DEFAULT 'USD',
          due_on      date NOT NULL
        );
        CREATE INDEX ON fee_due_dates (student_id, due_on);

        -- "Ask for a re-mark" (design/Results).
        CREATE TABLE remark_requests (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id   uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          offering_id  uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
          reason       text NOT NULL,
          status       text NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received','in_review','upheld','changed','rejected')),
          created_at   timestamptz NOT NULL DEFAULT now(),
          decided_at   timestamptz,
          outcome      text,
          UNIQUE (student_id, offering_id)
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE remark_requests; DROP TABLE fee_due_dates; DROP TABLE fee_transactions;")
