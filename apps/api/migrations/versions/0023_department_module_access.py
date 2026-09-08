"""Add editable module access rules for roles, departments and users.

Revision ID: 0023_department_access
Revises: 0022_approval_deadlines
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_department_access"
down_revision: str | None = "0022_approval_deadlines"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_core_departments_parent",
        "core_departments",
        ["parent_id"],
    )
    op.create_table(
        "core_module_access_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("subject_type", sa.String(length=16), nullable=False),
        sa.Column("subject_key", sa.String(length=96), nullable=False),
        sa.Column("module_key", sa.String(length=64), nullable=False),
        sa.Column(
            "permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "subject_type IN ('role', 'department', 'user')",
            name="ck_core_module_access_rules_subject_type",
        ),
        sa.UniqueConstraint(
            "subject_type",
            "subject_key",
            "module_key",
            name="uq_core_module_access_rule_subject_module",
        ),
    )
    op.create_index(
        "ix_core_module_access_rules_subject",
        "core_module_access_rules",
        ["subject_type", "subject_key"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_core_module_access_rules_subject",
        table_name="core_module_access_rules",
    )
    op.drop_table("core_module_access_rules")
    op.drop_index("ix_core_departments_parent", table_name="core_departments")
