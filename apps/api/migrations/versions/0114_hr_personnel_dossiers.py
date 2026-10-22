"""Private employee dossiers, scoped access and value-free revision history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0114_hr_personnel_dossiers"
down_revision = "0113_grant_launch_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "hr_personnel_dossiers",
        sa.Column("user_id", uid, sa.ForeignKey("core_users.id"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision > 0", name="ck_dossier_revision"),
        sa.CheckConstraint("status IN ('draft','saved')", name="ck_dossier_status"),
    )
    op.create_table(
        "hr_dossier_history",
        sa.Column("id", uid, primary_key=True),
        sa.Column("user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("changed_fields", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "revision", name="uq_dossier_history_revision"),
    )
    op.create_table(
        "hr_dossier_access_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_dossier_settings_singleton"),
    )
    op.execute("INSERT INTO hr_dossier_access_settings (id, revision) VALUES (1, 0)")
    op.create_table(
        "hr_dossier_access_rules",
        sa.Column("id", uid, primary_key=True),
        sa.Column("grantee_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("scope_id", uid),
        sa.Column("view", sa.Boolean(), nullable=False),
        sa.Column("edit", sa.Boolean(), nullable=False),
        sa.Column("photo_roster", sa.Boolean(), nullable=False),
        sa.CheckConstraint("(scope = 'all' AND scope_id IS NULL) OR "
                           "(scope IN ('employee','department') AND scope_id IS NOT NULL)",
                           name="ck_dossier_access_scope"),
        sa.CheckConstraint("NOT edit OR view", name="ck_dossier_edit_requires_view"),
    )
    op.create_index("ix_dossier_access_grantee", "hr_dossier_access_rules", ["grantee_user_id"])


def downgrade() -> None:
    raise RuntimeError("Personnel dossiers contain private employee records; preserve the data")
