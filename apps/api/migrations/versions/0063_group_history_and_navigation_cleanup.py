"""Limit newly invited members' history and remove a retired navigation entry."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0063_group_history_nav_cleanup"
down_revision: str | None = "0062_reward_catalog_and_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messenger_chat_members",
        sa.Column("history_visible_from", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("messenger_messages", sa.Column("system_kind", sa.String(32)))
    op.add_column("messenger_messages", sa.Column("system_target_user_id", sa.UUID()))
    op.execute(
        """
        UPDATE workspace_personal_preferences
        SET navigation_order = COALESCE((
            SELECT jsonb_agg(item.value ORDER BY item.position)
            FROM jsonb_array_elements_text(navigation_order)
                WITH ORDINALITY AS item(value, position)
            WHERE item.value <> 'crm'
        ), '[]'::jsonb), revision = revision + 1
        WHERE navigation_order @> '["crm"]'::jsonb
        """
    )
    op.execute("DELETE FROM core_module_access_rules WHERE module_key = 'crm'")


def downgrade() -> None:
    # Personal menu ordering and obsolete access rules are intentionally not restored.
    op.drop_column("messenger_messages", "system_target_user_id")
    op.drop_column("messenger_messages", "system_kind")
    op.drop_column("messenger_chat_members", "history_visible_from")
