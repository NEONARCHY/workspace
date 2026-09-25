"""Shared document preflight, recorded comments and pinned final PDF."""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0055_ai_referent_preflight"
down_revision: str | None = "0054_ai_referent_operator_edit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ai_referent_letters", sa.Column("final_pdf_file_id", sa.Uuid()))
    # Pin only a completed preparation's exact output, never an arbitrary old PDF.
    op.execute("""
        UPDATE ai_referent_letters l SET final_pdf_file_id = (
            SELECT f.id FROM ai_referent_delivery_commands c
            JOIN ai_referent_files f ON f.owner_id = c.letter_id
                AND f.kind = 'outgoing' AND f.relative_path = 'signed/' || c.id::text || '.pdf'
            WHERE c.letter_id = l.id AND c.status = 'completed'
                AND c.kind IN ('prepare', 'reprepare') AND c.result->>'outcome' = 'prepared'
            ORDER BY c.completed_at DESC LIMIT 1
        ) WHERE l.workflow_kind = 'delivery'
            AND l.status IN ('awaiting_final_send', 'referent_review_pending', 'sent',
                             'queued', 'sending', 'delivery_unknown')
    """)
    # Older versions could wait for Bobur before producing the PDF. Prepare those
    # letters now, but never enqueue their external send during the upgrade.
    connection = op.get_bind()
    waiting = (
        connection.execute(
            sa.text("""
        SELECT id, route FROM ai_referent_letters
        WHERE status = 'awaiting_final_send' AND final_pdf_file_id IS NULL
            AND workflow_kind = 'delivery'
    """)
        )
        .mappings()
        .all()
    )
    for row in waiting:
        connection.execute(
            sa.text("""
            INSERT INTO ai_referent_delivery_commands
                (id, letter_id, route, status, kind, idempotency_key, attempt_count,
                 last_error, created_at, updated_at)
            VALUES (:id, :letter_id, :route, 'pending', 'prepare', :key, 0, '', now(), now())
        """),
            {
                "id": uuid4(),
                "letter_id": row["id"],
                "route": row["route"],
                "key": f"migration55:prepare:{row['id']}",
            },
        )
        connection.execute(
            sa.text("""
            UPDATE ai_referent_letters SET status = 'queued', revision = revision + 1,
                updated_at = now() WHERE id = :id
        """),
            {"id": row["id"]},
        )
    op.create_table(
        "ai_referent_document_checks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("workflow_kind", sa.String(16), nullable=False),
        sa.Column("configuration_revision", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(500), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reviewer_keys", postgresql.JSONB(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("claimed_by", sa.String(128)),
        sa.Column("lease_token", sa.Uuid()),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "user_id",
            "sha256",
            "workflow_kind",
            "configuration_revision",
            name="uq_ai_document_check",
        ),
        sa.CheckConstraint(
            "status IN ('pending','checking','passed','failed')", name="ck_ai_document_check_status"
        ),
    )
    op.create_index(
        "ix_ai_document_check_queue", "ai_referent_document_checks", ["status", "created_at"]
    )
    op.create_table(
        "ai_referent_comment_audio",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "letter_id",
            sa.Uuid(),
            sa.ForeignKey("ai_referent_letters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    # Preserve audit media: require an explicit export before schema rollback.
    op.execute(
        "SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM ai_referent_comment_audio) THEN 0 ELSE 1 END"
    )
    op.drop_table("ai_referent_comment_audio")
    op.drop_table("ai_referent_document_checks")
    op.drop_column("ai_referent_letters", "final_pdf_file_id")
