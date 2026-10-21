"""Private Gmail connections, encrypted drafts and send receipts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0111_personal_mail"
down_revision = "0110_grants_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uid = postgresql.UUID(as_uuid=True)
    timestamp = sa.DateTime(timezone=True)
    op.create_table(
        "mail_accounts",
        sa.Column("id", uid, primary_key=True),
        sa.Column(
            "owner_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False, unique=True
        ),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("refresh_cipher", sa.Text(), nullable=False),
        sa.Column("access_cipher", sa.Text(), nullable=False),
        sa.Column("access_expires_at", timestamp, nullable=False),
        sa.Column("reconnect_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("connected_at", timestamp, nullable=False),
    )
    op.create_table(
        "mail_oauth_requests",
        sa.Column("id", uid, primary_key=True),
        sa.Column("owner_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("state_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("verifier_cipher", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("expires_at", timestamp, nullable=False),
    )
    op.create_index("ix_mail_oauth_expiry", "mail_oauth_requests", ["expires_at"])
    op.create_table(
        "mail_drafts",
        sa.Column("id", uid, primary_key=True),
        sa.Column("owner_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column(
            "account_id", uid, sa.ForeignKey("mail_accounts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("payload_cipher", sa.Text(), nullable=False),
        sa.Column("reply_message_id", sa.String(200)),
        sa.Column("reply_cipher", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("operation_id", uid, unique=True),
        sa.Column("provider_message_id", sa.String(200)),
        sa.Column("rfc_message_id", sa.String(320)),
        sa.Column("error", sa.String(400), nullable=False, server_default=""),
        sa.Column("updated_at", timestamp, nullable=False),
        sa.CheckConstraint(
            "status IN ('draft','queued','sending','sent','unknown','failed')",
            name="ck_mail_draft_status",
        ),
        sa.CheckConstraint("revision > 0", name="ck_mail_draft_revision"),
    )
    op.create_index("ix_mail_drafts_owner", "mail_drafts", ["owner_user_id", "updated_at"])
    op.create_index("ix_mail_drafts_queue", "mail_drafts", ["status", "updated_at"])
    op.create_table(
        "mail_files",
        sa.Column("id", uid, primary_key=True),
        sa.Column(
            "draft_id", uid, sa.ForeignKey("mail_drafts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("file_name", sa.String(240), nullable=False),
        sa.Column("content_type", sa.String(160), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_cipher", sa.LargeBinary(), nullable=False),
        # Keep provenance after source cleanup so a queued send can reject a stale PDF.
        sa.Column("signed_letter_id", uid),
        sa.Column("signed_file_id", uid),
        sa.Column("sha256", sa.String(64), nullable=False),
    )
    op.create_index("ix_mail_files_draft", "mail_files", ["draft_id"])
    op.create_table(
        "mail_task_exports",
        sa.Column("id", uid, primary_key=True),
        sa.Column("owner_user_id", uid, sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("source_cipher", sa.Text(), nullable=False),
        sa.Column("task_id", uid, sa.ForeignKey("tasks.id", ondelete="CASCADE")),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(
        sa.text("SELECT EXISTS (SELECT 1 FROM mail_accounts) OR EXISTS (SELECT 1 FROM mail_drafts)")
    ):
        raise RuntimeError("Disconnect mail accounts and preserve receipts before downgrading")
    for name in (
        "mail_task_exports",
        "mail_files",
        "mail_drafts",
        "mail_oauth_requests",
        "mail_accounts",
    ):
        op.drop_table(name)
