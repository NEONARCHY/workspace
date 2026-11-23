"""Link locally registered incoming documents to their execution tasks."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0127_incoming_document_execution"
down_revision = "0126_session_admin_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "incoming_document_executions",
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey(
            "ai_referent_incoming_letters.id", ondelete="RESTRICT",
        ), primary_key=True),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey(
            "tasks.id", ondelete="RESTRICT",
        ), nullable=False, unique=True),
        sa.Column("operation_id", UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"),
                  nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("incoming_document_executions")
