"""Permit audited task deletion to remove its append-only chat history."""

from collections.abc import Sequence

from alembic import op

revision: str = "0070_task_chat_purge"
down_revision: str = "0069_task_deadline_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_messenger_versions() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE'
               AND current_setting('yuksalish.task_chat_purge', true) = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'Message history is append-only';
        END $$
    """)


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_messenger_versions() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Message history is append-only';
        END $$
    """)
