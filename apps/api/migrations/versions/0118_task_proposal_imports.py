"""Audited administrative batches of private task proposals."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0118_task_proposal_imports"
down_revision = "0117_chairman_memoranda"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_proposal_import_batches",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "creator_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False
        ),
        sa.Column(
            "author_user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False
        ),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("source_name", sa.String(240), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("author_user_id", "content_hash", name="uq_task_import_content"),
    )
    op.add_column("task_proposals", sa.Column("import_batch_id", UUID(as_uuid=True)))
    op.add_column("task_proposals", sa.Column("import_source_key", sa.String(300)))
    op.create_foreign_key(
        "fk_task_proposal_import_batch",
        "task_proposals",
        "task_proposal_import_batches",
        ["import_batch_id"],
        ["id"],
    )
    op.create_unique_constraint(
        "uq_task_proposal_import_source", "task_proposals", ["import_batch_id", "import_source_key"]
    )
    op.create_check_constraint(
        "ck_task_proposal_import_source",
        "task_proposals",
        "(import_batch_id IS NULL AND import_source_key IS NULL) OR "
        "(import_batch_id IS NOT NULL AND import_source_key IS NOT NULL)",
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM task_proposal_import_batches")):
        raise RuntimeError("Imported proposals exist; preserve them and roll back application only")
    op.drop_constraint("ck_task_proposal_import_source", "task_proposals", type_="check")
    op.drop_constraint("uq_task_proposal_import_source", "task_proposals", type_="unique")
    op.drop_constraint("fk_task_proposal_import_batch", "task_proposals", type_="foreignkey")
    op.drop_column("task_proposals", "import_source_key")
    op.drop_column("task_proposals", "import_batch_id")
    op.drop_table("task_proposal_import_batches")
