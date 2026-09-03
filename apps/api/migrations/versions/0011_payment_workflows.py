"""Version payment workflows and add complete request metadata.

Revision ID: 0011_payment_workflows
Revises: 0010_task_management
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_payment_workflows"
down_revision: str | None = "0010_task_management"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "approval_requests",
        sa.Column(
            "responsible_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_approval_requests_responsible_user",
        "approval_requests",
        "core_users",
        ["responsible_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        "UPDATE approval_requests "
        "SET responsible_user_id = requester_user_id "
        "WHERE responsible_user_id IS NULL"
    )
    op.alter_column("approval_requests", "responsible_user_id", nullable=False)
    op.add_column(
        "approval_requests",
        sa.Column(
            "actor_overrides",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index(
        "ix_approval_requests_responsible_status",
        "approval_requests",
        ["responsible_user_id", "status"],
    )

    op.add_column(
        "approval_actions",
        sa.Column(
            "delegated_to_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_approval_actions_delegated_to_user",
        "approval_actions",
        "core_users",
        ["delegated_to_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.drop_constraint("ck_approval_actions_action", "approval_actions", type_="check")
    op.create_check_constraint(
        "ck_approval_actions_action",
        "approval_actions",
        "action IN ('approve', 'reject', 'return', 'clarify', 'delegate', 'resubmit', 'cancel')",
    )

    op.add_column(
        "workspace_attachments",
        sa.Column(
            "document_role",
            sa.String(length=24),
            nullable=False,
            server_default="general",
        ),
    )
    op.create_check_constraint(
        "ck_workspace_attachments_document_role",
        "workspace_attachments",
        "document_role IN ('general', 'primary', 'additional')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_workspace_attachments_document_role",
        "workspace_attachments",
        type_="check",
    )
    op.drop_column("workspace_attachments", "document_role")

    op.drop_constraint("ck_approval_actions_action", "approval_actions", type_="check")
    op.create_check_constraint(
        "ck_approval_actions_action",
        "approval_actions",
        "action IN ('approve', 'reject', 'return', 'clarify', 'delegate', 'resubmit')",
    )
    op.drop_constraint(
        "fk_approval_actions_delegated_to_user",
        "approval_actions",
        type_="foreignkey",
    )
    op.drop_column("approval_actions", "delegated_to_user_id")

    op.drop_index(
        "ix_approval_requests_responsible_status",
        table_name="approval_requests",
    )
    op.drop_column("approval_requests", "actor_overrides")
    op.drop_constraint(
        "fk_approval_requests_responsible_user",
        "approval_requests",
        type_="foreignkey",
    )
    op.drop_column("approval_requests", "responsible_user_id")
