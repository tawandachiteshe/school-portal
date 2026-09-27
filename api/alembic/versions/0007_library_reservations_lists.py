"""Library: editions, reservations, module reading lists

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE library_items ADD COLUMN edition text;          -- '7th edition'

        -- design/Library "Reserved · 1 … Collect from the desk by Sat 13 Mar · Ready"
        CREATE TABLE library_reservations (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          item_id     uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
          person_id   uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          status      text NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting','ready','collected','cancelled','expired')),
          copy_id     uuid REFERENCES library_copies(id),              -- set when a copy is held for them
          created_at  timestamptz NOT NULL DEFAULT now(),
          ready_at    timestamptz,
          collect_by  date
        );
        CREATE UNIQUE INDEX library_one_open_reservation
          ON library_reservations (item_id, person_id) WHERE status IN ('waiting','ready');
        CREATE INDEX ON library_reservations (item_id, created_at) WHERE status = 'waiting';

        -- Books a lecturer recommends for a module (design/Library "Reading lists").
        CREATE TABLE reading_list_items (
          offering_id uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
          item_id     uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
          note        text,                                           -- 'Chapters 3 and 4'
          is_core     boolean NOT NULL DEFAULT true,
          sort_order  smallint NOT NULL DEFAULT 0,
          PRIMARY KEY (offering_id, item_id)
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE reading_list_items;
        DROP TABLE library_reservations;
        ALTER TABLE library_items DROP COLUMN edition;
    """)
