import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from .tables import metadata

memoranda = sa.Table(
    "chairman_memoranda",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column(
        "requester_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False
    ),
    sa.Column("chair_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False),
    sa.Column("title", sa.String(160), nullable=False),
    sa.Column("body", sa.Text(), nullable=False),
    sa.Column("status", sa.String(24), nullable=False),
    sa.Column("revision", sa.Integer(), nullable=False),
    sa.Column("requester_name", sa.String(200), nullable=False),
    sa.Column("requester_title", sa.String(240), nullable=False),
    sa.Column("chair_name", sa.String(200), nullable=False),
    sa.Column("decision_comment", sa.Text(), nullable=False),
    sa.Column("pdf_content", sa.LargeBinary()),
    sa.Column("pdf_sha256", sa.String(64)),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("submitted_at", sa.DateTime(timezone=True)),
    sa.Column("decided_at", sa.DateTime(timezone=True)),
    sa.Column("document_script", sa.String(16)),
    sa.Column("hr_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id")),
    sa.Column("accountant_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id")),
    sa.Column("hr_completed_at", sa.DateTime(timezone=True)),
    sa.Column("completed_at", sa.DateTime(timezone=True)),
    sa.Column("order_file_name", sa.String(240)),
    sa.Column("order_content", sa.LargeBinary()),
    sa.Column("order_sha256", sa.String(64)),
)
