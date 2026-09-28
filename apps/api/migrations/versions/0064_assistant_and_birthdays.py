"""Persist assistant messages and annually materialized birthday posts."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064_assistant_and_birthdays"
down_revision: str | None = "0063_group_history_nav_cleanup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("feed_posts", "author_user_id", existing_type=sa.UUID(), nullable=True)
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind", "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom',"
        "'hisobot','support','birthday')",
    )
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section", "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding','ai_hisobot','notifications','feed')",
    )
    op.add_column("core_users", sa.Column("birthday_month", sa.SmallInteger()))
    op.add_column("core_users", sa.Column("birthday_day", sa.SmallInteger()))
    op.create_check_constraint(
        "ck_core_users_birthday_pair", "core_users",
        "(birthday_month IS NULL AND birthday_day IS NULL) OR "
        "(birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND 31)",
    )
    op.add_column("feed_posts", sa.Column("system_kind", sa.String(32)))
    op.add_column("feed_posts", sa.Column("birthday_user_id", sa.UUID()))
    op.add_column("feed_posts", sa.Column("birthday_year", sa.SmallInteger()))
    op.create_foreign_key(
        "fk_feed_posts_birthday_user", "feed_posts", "core_users",
        ["birthday_user_id"], ["id"], ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_feed_birthday_user_year", "feed_posts", ["birthday_user_id", "birthday_year"],
    )
    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_assistant_messages_user_created", "assistant_messages", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.execute("DELETE FROM workspace_notifications WHERE kind = 'birthday'")
    op.execute("DELETE FROM feed_posts WHERE system_kind = 'birthday'")
    op.drop_index("ix_assistant_messages_user_created", table_name="assistant_messages")
    op.drop_table("assistant_messages")
    op.drop_constraint("uq_feed_birthday_user_year", "feed_posts", type_="unique")
    op.drop_constraint("fk_feed_posts_birthday_user", "feed_posts", type_="foreignkey")
    op.drop_column("feed_posts", "birthday_year")
    op.drop_column("feed_posts", "birthday_user_id")
    op.drop_column("feed_posts", "system_kind")
    op.alter_column("feed_posts", "author_user_id", existing_type=sa.UUID(), nullable=False)
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section", "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent',"
        "'project_hub','project_funding','ai_hisobot','notifications')",
    )
    op.drop_constraint("ck_workspace_notifications_kind", "workspace_notifications", type_="check")
    op.create_check_constraint(
        "ck_workspace_notifications_kind", "workspace_notifications",
        "kind IN ('message','task','approval','trip','calendar','absence','zoom',"
        "'hisobot','support')",
    )
    op.drop_constraint("ck_core_users_birthday_pair", "core_users", type_="check")
    op.drop_column("core_users", "birthday_day")
    op.drop_column("core_users", "birthday_month")
