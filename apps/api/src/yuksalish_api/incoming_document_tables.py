"""A registered incoming document has one persistent execution task."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from .tables import metadata

incoming_document_executions = sa.Table(
    "incoming_document_executions", metadata,
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
