"""Store desktop releases and the administrator-controlled update gate.

Revision ID: 0025_desktop_updates
Revises: 0024_admin_controls
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0025_desktop_updates"
down_revision: str | None = "0024_admin_controls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_core_users_single_superadmin",
        "core_users",
        ["role"],
        unique=True,
        postgresql_where=sa.text("role = 'superadmin'"),
    )
    op.create_table(
        "workspace_update_releases",
        sa.Column("version", sa.String(32), primary_key=True),
        sa.Column("file_name", sa.String(160), nullable=False, unique=True),
        sa.Column("sha512", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("size_bytes > 0", name="ck_update_release_positive_size"),
    )
    op.create_table(
        "workspace_update_policy",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("published_version", sa.String(32), nullable=True),
        sa.Column("minimum_version", sa.String(32), nullable=True),
        sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_update_policy_singleton"),
        sa.ForeignKeyConstraint(
            ["published_version"], ["workspace_update_releases.version"]
        ),
        sa.ForeignKeyConstraint(
            ["minimum_version"], ["workspace_update_releases.version"]
        ),
    )
    op.execute("INSERT INTO workspace_update_policy (id, mandatory) VALUES (1, false)")


def downgrade() -> None:
    op.drop_table("workspace_update_policy")
    op.drop_table("workspace_update_releases")
    op.drop_index("uq_core_users_single_superadmin", table_name="core_users")
