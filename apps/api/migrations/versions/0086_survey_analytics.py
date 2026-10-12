"""Private survey workbooks and author-owned interpretation settings."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0086_survey_analytics"
down_revision: str = "0085_merge_edo_employee_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "survey_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("core_users.id"), nullable=False),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("file_name", sa.String(240), nullable=False),
        sa.Column("original_key", sa.String(200), nullable=False),
        sa.Column("parsed_key", sa.String(200), nullable=False),
        sa.Column("configuration", postgresql.JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "request_id", name="uq_survey_owner_request"),
        sa.CheckConstraint("revision > 0", name="survey_revision_positive"),
    )
    op.create_index("ix_survey_owner_updated", "survey_analyses", ["owner_user_id", "updated_at"])


def downgrade() -> None:
    raise RuntimeError("Survey data is private durable content. Use a reviewed retention plan.")
