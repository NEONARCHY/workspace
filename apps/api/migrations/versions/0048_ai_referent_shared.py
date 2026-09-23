"""Shared letter execution, Telegram identities and durable file packages."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0048_ai_referent_shared"
down_revision: str | None = "0047_calendar_collaboration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ai_referent_configuration", sa.Column("execution_agent_id", sa.String(128)))
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'calendar','absences','zoom_meetings','hr','team_overview','ai_referent')",
    )
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint(
        "ck_ai_letters_status",
        "ai_referent_letters",
        "status IN ('draft','pending_review','needs_revision','approved','queued','sending',"
        "'sent','failed','cancelled','awaiting_final_send','referent_review_pending',"
        "'delivery_unknown')",
    )
    op.add_column("ai_referent_letters", sa.Column("final_reviewer_user_id", postgresql.UUID()))
    op.add_column("ai_referent_letters", sa.Column("final_reviewer_key", sa.String(32)))
    op.add_column("ai_referent_letters", sa.Column("initial_reviewer_user_id", postgresql.UUID()))
    op.add_column("ai_referent_letters", sa.Column("initial_reviewer_key", sa.String(32)))
    op.create_foreign_key(
        "fk_ai_initial_reviewer",
        "ai_referent_letters",
        "core_users",
        ["initial_reviewer_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Prior versions only had a single reviewer: preserve that explicit assignment.
    op.execute(
        "UPDATE ai_referent_letters SET initial_reviewer_user_id = reviewer_user_id, "
        "initial_reviewer_key = reviewer_key"
    )
    op.add_column(
        "ai_referent_letters",
        sa.Column("delivery_error", sa.Text(), server_default="", nullable=False),
    )
    op.create_foreign_key(
        "fk_ai_final_reviewer",
        "ai_referent_letters",
        "core_users",
        ["final_reviewer_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "ai_referent_delivery_commands",
        sa.Column("kind", sa.String(16), server_default="prepare", nullable=False),
    )
    op.add_column("ai_referent_delivery_commands", sa.Column("lease_token", postgresql.UUID()))
    op.add_column("ai_referent_delivery_commands", sa.Column("result", postgresql.JSONB()))
    op.create_table(
        "ai_referent_telegram_links",
        sa.Column(
            "user_id",
            postgresql.UUID(),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("telegram_id", sa.String(20), unique=True, nullable=True),
        sa.Column("code_hash", sa.String(64), unique=True, nullable=True),
        sa.Column("code_expires_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "ai_referent_operations",
        sa.Column("operation_id", postgresql.UUID(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("letter_id", postgresql.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "ai_referent_telegram_outbox",
        sa.Column("id", postgresql.UUID(), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "letter_id",
            postgresql.UUID(),
            sa.ForeignKey("ai_referent_letters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_key", sa.String(160), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("lease_token", postgresql.UUID()),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.String(500), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "event_key", name="uq_ai_telegram_event"),
    )
    op.create_index(
        "ix_ai_telegram_pending", "ai_referent_telegram_outbox", ["delivered_at", "lease_until"]
    )
    op.create_table(
        "ai_referent_archive",
        sa.Column("id", postgresql.UUID(), primary_key=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("external_id", sa.String(160), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("agent_id", "external_id", name="uq_ai_archive_source"),
    )
    op.create_table(
        "ai_referent_files",
        sa.Column("id", postgresql.UUID(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("owner_id", postgresql.UUID(), nullable=False),
        sa.Column("relative_path", sa.String(500), nullable=False),
        sa.Column("storage_key", sa.String(600), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("content_type", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "kind", "owner_id", "relative_path", "sha256", name="uq_ai_packet_version"
        ),
    )


def downgrade() -> None:
    # Fail rather than discard newly introduced workflow states during a live rollback.
    op.execute(
        "SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM ai_referent_letters WHERE "
        "status IN ('awaiting_final_send','referent_review_pending','delivery_unknown')) "
        "THEN 0 ELSE 1 END"
    )
    # Keep the widened notification constraint: audit/notification history is not deleted.
    op.drop_column("ai_referent_configuration", "execution_agent_id")
    for table in (
        "ai_referent_files",
        "ai_referent_archive",
        "ai_referent_telegram_outbox",
        "ai_referent_operations",
        "ai_referent_telegram_links",
    ):
        op.drop_table(table)
    for column in ("kind", "lease_token", "result"):
        op.drop_column("ai_referent_delivery_commands", column)
    op.drop_constraint("fk_ai_final_reviewer", "ai_referent_letters", type_="foreignkey")
    op.drop_constraint("fk_ai_initial_reviewer", "ai_referent_letters", type_="foreignkey")
    op.drop_column("ai_referent_letters", "initial_reviewer_user_id")
    op.drop_column("ai_referent_letters", "initial_reviewer_key")
    for column in ("final_reviewer_user_id", "final_reviewer_key", "delivery_error"):
        op.drop_column("ai_referent_letters", column)
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint(
        "ck_ai_letters_status",
        "ai_referent_letters",
        "status IN ('draft','pending_review','needs_revision','approved',"
        "'queued','sending','sent','failed','cancelled')",
    )
