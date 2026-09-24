"""Add public recognition settings and manager-issued employee rewards."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0051_employee_recognition"
down_revision: str | None = "0050_ai_referent_recipients"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "employee_recognition_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "active_task_count_visible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("updated_by_user_id", sa.UUID(), sa.ForeignKey("core_users.id")),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("id = 1", name="ck_employee_recognition_settings_singleton"),
    )
    op.create_table(
        "employee_rewards",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "recipient_user_id",
            sa.UUID(),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column(
            "issuer_user_id",
            sa.UUID(),
            sa.ForeignKey("core_users.id"),
            nullable=False,
        ),
        sa.Column("icon_key", sa.String(32), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "recipient_user_id <> issuer_user_id",
            name="ck_employee_reward_not_self",
        ),
    )
    op.create_index(
        "ix_employee_rewards_recipient_created",
        "employee_rewards",
        ["recipient_user_id", "created_at"],
    )
    op.create_index(
        "ix_employee_rewards_issuer_created",
        "employee_rewards",
        ["issuer_user_id", "created_at"],
    )
    op.execute(
        "INSERT INTO employee_recognition_settings "
        "(id, active_task_count_visible) VALUES (1, TRUE)"
    )


def downgrade() -> None:
    op.drop_index("ix_employee_rewards_issuer_created", table_name="employee_rewards")
    op.drop_index("ix_employee_rewards_recipient_created", table_name="employee_rewards")
    op.drop_table("employee_rewards")
    op.drop_table("employee_recognition_settings")
