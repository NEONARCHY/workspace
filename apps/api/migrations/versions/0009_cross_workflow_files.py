"""Add shared attachments and immutable approval request revisions.

Revision ID: 0009_cross_workflow_files
Revises: 0008_directory_positions
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_cross_workflow_files"
down_revision: str | None = "0008_directory_positions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "approval_requests",
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_table(
        "workspace_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_type", sa.String(length=32), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=160), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column(
            "uploaded_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "owner_type IN ('message', 'task', 'approval_request')",
            name="ck_workspace_attachments_owner_type",
        ),
        sa.CheckConstraint("byte_size > 0", name="ck_workspace_attachments_byte_size"),
        sa.UniqueConstraint("storage_key", name="uq_workspace_attachments_storage_key"),
    )
    op.create_index(
        "ix_workspace_attachments_owner",
        "workspace_attachments",
        ["owner_type", "owner_id", "created_at"],
    )
    op.create_table(
        "approval_request_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "attachment_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "edited_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("change_reason", sa.String(length=48), nullable=False),
        sa.Column("change_comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version > 0", name="ck_approval_request_versions_version"),
        sa.UniqueConstraint(
            "request_id",
            "version",
            name="uq_approval_request_versions_request_version",
        ),
    )
    op.create_index(
        "ix_approval_request_versions_request_created",
        "approval_request_versions",
        ["request_id", "created_at"],
    )

    connection = op.get_bind()
    request_rows = connection.execute(
        sa.text(
            "SELECT id, requester_user_id, title, payload, created_at "
            "FROM approval_requests ORDER BY created_at"
        )
    ).mappings()
    version_table = sa.table(
        "approval_request_versions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("request_id", postgresql.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("title", sa.String()),
        sa.column("payload", postgresql.JSONB()),
        sa.column("attachment_ids", postgresql.JSONB()),
        sa.column("edited_by_user_id", postgresql.UUID(as_uuid=True)),
        sa.column("change_reason", sa.String()),
        sa.column("change_comment", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    versions = [
        {
            "id": uuid4(),
            "request_id": row["id"],
            "version": 1,
            "title": row["title"],
            "payload": row["payload"],
            "attachment_ids": [],
            "edited_by_user_id": row["requester_user_id"],
            "change_reason": "initial",
            "change_comment": None,
            "created_at": row["created_at"],
        }
        for row in request_rows
    ]
    if versions:
        op.bulk_insert(version_table, versions)


def downgrade() -> None:
    op.drop_index(
        "ix_approval_request_versions_request_created",
        table_name="approval_request_versions",
    )
    op.drop_table("approval_request_versions")
    op.drop_index("ix_workspace_attachments_owner", table_name="workspace_attachments")
    op.drop_table("workspace_attachments")
    op.drop_column("approval_requests", "current_version")
