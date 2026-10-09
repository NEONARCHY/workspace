"""Private project import packages, durable jobs and reviewed source archive."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0083_project_document_imports"
down_revision: str = "0082_assistant_chat_pins"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project_hub_items", sa.Column(
        "schedule_pending", sa.Boolean(), nullable=False, server_default=sa.false(),
    ))
    op.create_table(
        "project_document_imports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("project_hub_projects.id"), unique=True),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("documents", postgresql.JSONB(), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("published_request", postgresql.JSONB()),
        sa.Column("lease_id", postgresql.UUID(as_uuid=True)),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision > 0", name="project_import_revision_positive"),
        sa.CheckConstraint(
            "state IN ('draft','queued','processing','ready','failed','published')",
            name="project_import_state_valid",
        ),
    )
    op.create_index("ix_project_import_creator", "project_document_imports",
                    ["created_by_user_id", "updated_at"])
    op.create_index("ix_project_import_queue", "project_document_imports",
                    ["state", "lease_until"])


def downgrade() -> None:
    op.drop_table("project_document_imports")
    op.drop_column("project_hub_items", "schedule_pending")
