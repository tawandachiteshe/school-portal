"""Application fee and declaration (design/Submit, Payment, PayWaiting, PayFailed, PayOffice)

Revision ID: 0013
Revises: 0012
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE applications ADD COLUMN declared_at timestamptz;
        CREATE TABLE application_payments (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          method         text NOT NULL CHECK (method IN ('ecocash','onemoney','bank','cash')),
          status         text NOT NULL CHECK (status IN
                           ('awaiting_approval','paid','failed','expired','awaiting_confirmation','cancelled')),
          amount         numeric(10,2) NOT NULL CHECK (amount > 0),
          currency       char(3) NOT NULL DEFAULT 'USD',
          phone          text CHECK (phone IS NULL OR phone ~ '^\\+[1-9][0-9]{7,14}$'),
          provider       text,                        -- which gateway handled a mobile payment
          provider_ref   text,
          receipt        text,                        -- the provider's or Accounts' receipt number
          failure        text,                        -- the provider's reason, in plain words
          proof_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
          expires_at     timestamptz,                 -- mobile prompt
          paid_at        timestamptz,
          confirmed_by   uuid REFERENCES users(id),   -- Accounts / Admissions, for bank and cash
          created_at     timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX application_payments_app ON application_payments (application_id, created_at DESC);
        CREATE INDEX application_payments_to_confirm ON application_payments (created_at)
          WHERE status = 'awaiting_confirmation';
        ALTER TYPE document_kind ADD VALUE IF NOT EXISTS 'payment_proof';
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE application_payments;
        ALTER TABLE applications DROP COLUMN declared_at;
    """)
