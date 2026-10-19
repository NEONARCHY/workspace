"""Internal reference directory: one legal profile, partners, experts and versioned templates.

Revision ID: 0108_reference_directory
Revises: 0107_trip_cleanup_actions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0108_reference_directory"
down_revision: str = "0107_trip_cleanup_actions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "reference_profile",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("legal_name", sa.String(240), nullable=False, server_default=""),
        sa.Column("short_name", sa.String(160), nullable=False, server_default=""),
        sa.Column("tin", sa.String(24), nullable=False, server_default=""),
        sa.Column("registered_address", sa.Text(), nullable=False, server_default=""),
        sa.Column("postal_address", sa.Text(), nullable=False, server_default=""),
        sa.Column("bank_name", sa.String(240), nullable=False, server_default=""),
        sa.Column("bank_code", sa.String(40), nullable=False, server_default=""),
        sa.Column("bank_account", sa.String(64), nullable=False, server_default=""),
        sa.Column("phone", sa.String(80), nullable=False, server_default=""),
        sa.Column("email", sa.String(240), nullable=False, server_default=""),
        sa.Column("website", sa.String(240), nullable=False, server_default=""),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by_user_id", uuid),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("id = 1", name="ck_reference_profile_singleton"),
    )
    op.execute(sa.text("INSERT INTO reference_profile (id) VALUES (1)"))
    op.create_table(
        "reference_partners",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("name", sa.String(240), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("tin", sa.String(24)),
        sa.Column("address", sa.Text(), nullable=False, server_default=""),
        sa.Column("contact_person", sa.String(160), nullable=False, server_default=""),
        sa.Column("phone", sa.String(80), nullable=False, server_default=""),
        sa.Column("email", sa.String(240), nullable=False, server_default=""),
        sa.Column("website", sa.String(240), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_user_id", uuid, nullable=False),
    )
    op.create_index(
        "uq_reference_partners_active_tin", "reference_partners", ["tin"],
        unique=True, postgresql_where=sa.text("tin IS NOT NULL AND archived = false"),
    )
    op.create_index(
        "uq_reference_partners_active_name", "reference_partners", [sa.text("lower(name)")],
        unique=True, postgresql_where=sa.text("archived = false"),
    )
    op.create_table(
        "reference_experts",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("specialization", sa.String(240), nullable=False),
        sa.Column("partner_id", uuid, sa.ForeignKey("reference_partners.id", ondelete="SET NULL")),
        sa.Column("phone", sa.String(80), nullable=False, server_default=""),
        sa.Column("email", sa.String(240), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_user_id", uuid, nullable=False),
    )
    op.create_table(
        "reference_templates",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("locale", sa.String(16), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_user_id", uuid, nullable=False),
    )
    op.create_table(
        "reference_template_versions",
        sa.Column("id", uuid, primary_key=True),
        sa.Column(
            "template_id", uuid,
            sa.ForeignKey("reference_templates.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(240), nullable=False),
        sa.Column("content_type", sa.String(160), nullable=False),
        sa.Column("storage_key", sa.String(240), nullable=False, unique=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", uuid, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("template_id", "version", name="uq_reference_template_version"),
    )


def downgrade() -> None:
    op.drop_table("reference_template_versions")
    op.drop_table("reference_templates")
    op.drop_table("reference_experts")
    op.drop_index("uq_reference_partners_active_name", table_name="reference_partners")
    op.drop_index("uq_reference_partners_active_tin", table_name="reference_partners")
    op.drop_table("reference_partners")
    op.drop_table("reference_profile")
