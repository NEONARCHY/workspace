"""Shared account-based reviewer configuration and runtime acknowledgements."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0046_ai_referent_reviewers"
down_revision: str | None = "0045_ai_referent_incoming"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_referent_configuration",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_ai_configuration_singleton"),
        sa.CheckConstraint("revision >= 1", name="ck_ai_configuration_revision"),
    )
    op.execute(
        "INSERT INTO ai_referent_configuration (id, revision, updated_at) "
        "VALUES (1, 1, CURRENT_TIMESTAMP)"
    )
    op.create_table(
        "ai_referent_reviewers",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("suggested_username", sa.String(64), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("telegram_id", sa.String(20), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["user_id"], ["core_users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("user_id", name="uq_ai_reviewer_user"),
        sa.UniqueConstraint("telegram_id", name="uq_ai_reviewer_telegram"),
    )
    table = sa.table(
        "ai_referent_reviewers",
        sa.column("key"),
        sa.column("label"),
        sa.column("suggested_username"),
    )
    op.bulk_insert(
        table,
        [
            {"key": "askar", "label": "Аскар", "suggested_username": "askar_mamatxanov"},
            {"key": "bobur", "label": "Бобур", "suggested_username": "bobur_bekmurodov"},
            {"key": "umid", "label": "Умид", "suggested_username": "umid_rajabov"},
            {
                "key": "davronbek",
                "label": "Давронбек",
                "suggested_username": "davronbek_lyutfiddinov",
            },
        ],
    )
    op.add_column("ai_referent_agents", sa.Column("configuration_revision", sa.Integer()))
    op.add_column(
        "ai_referent_agents", sa.Column("configuration_applied_at", sa.DateTime(timezone=True))
    )
    op.add_column(
        "ai_referent_agents", sa.Column("configuration_error", sa.String(500), nullable=True)
    )
    op.add_column("ai_referent_letters", sa.Column("reviewer_key", sa.String(32)))


def downgrade() -> None:
    op.drop_column("ai_referent_letters", "reviewer_key")
    op.drop_column("ai_referent_agents", "configuration_error")
    op.drop_column("ai_referent_agents", "configuration_applied_at")
    op.drop_column("ai_referent_agents", "configuration_revision")
    op.drop_table("ai_referent_reviewers")
    op.drop_table("ai_referent_configuration")
