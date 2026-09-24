"""Promote Telegram identities and add per-bot access grants."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0052_telegram_bot_access"
down_revision: str | None = "0051_employee_recognition"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("ai_referent_telegram_links", "core_telegram_identities")
    op.add_column(
        "core_telegram_identities",
        sa.Column("pending_telegram_id", sa.String(20)),
    )
    op.create_unique_constraint(
        "uq_core_telegram_identities_pending", "core_telegram_identities", ["pending_telegram_id"]
    )
    op.add_column(
        "core_telegram_identities",
        sa.Column("verified_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "core_telegram_identities",
        sa.Column("verification_source", sa.String(24)),
    )
    op.add_column(
        "core_telegram_identities",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )
    op.execute(
        "UPDATE core_telegram_identities SET verified_at = updated_at, "
        "verification_source = 'bot' WHERE telegram_id IS NOT NULL"
    )
    op.execute(
        "UPDATE core_telegram_identities i SET telegram_id = r.telegram_id, "
        "verified_at = now(), verification_source = 'legacy_admin' "
        "FROM ai_referent_reviewers r JOIN core_users u ON u.id = r.user_id "
        "WHERE i.user_id = r.user_id AND i.telegram_id IS NULL AND r.enabled "
        "AND r.telegram_id IS NOT NULL AND u.status = 'active' "
        "AND NOT EXISTS (SELECT 1 FROM core_telegram_identities other "
        "WHERE other.telegram_id = r.telegram_id)"
    )
    # Existing administrator-appointed reviewers retain access on rollout. A later
    # ID change must pass the new bot confirmation flow.
    op.execute(
        "INSERT INTO core_telegram_identities "
        "(user_id, telegram_id, verified_at, verification_source, updated_at, revision) "
        "SELECT r.user_id, r.telegram_id, now(), 'legacy_admin', now(), 1 "
        "FROM ai_referent_reviewers r JOIN core_users u ON u.id = r.user_id "
        "WHERE r.enabled AND r.telegram_id IS NOT NULL AND u.status = 'active' "
        "AND NOT EXISTS (SELECT 1 FROM core_telegram_identities i WHERE i.user_id = r.user_id) "
        "AND NOT EXISTS (SELECT 1 FROM core_telegram_identities i "
        "WHERE i.telegram_id = r.telegram_id)"
    )
    op.create_table(
        "core_telegram_bot_grants",
        sa.Column(
            "user_id", postgresql.UUID(), sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("bot_key", sa.String(40), primary_key=True),
        sa.Column("updated_by_user_id", postgresql.UUID()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute(
        "INSERT INTO core_telegram_bot_grants (user_id, bot_key, updated_at) "
        "SELECT user_id, 'ai_referent', now() FROM core_telegram_identities "
        "WHERE telegram_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_table("core_telegram_bot_grants")
    op.drop_column("core_telegram_identities", "revision")
    op.drop_column("core_telegram_identities", "verification_source")
    op.drop_column("core_telegram_identities", "verified_at")
    op.drop_constraint("uq_core_telegram_identities_pending", "core_telegram_identities")
    op.drop_column("core_telegram_identities", "pending_telegram_id")
    op.rename_table("core_telegram_identities", "ai_referent_telegram_links")
