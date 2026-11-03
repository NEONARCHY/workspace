"""Memorandum script and HR/accounting stages; historical PDFs remain unchanged."""

import sqlalchemy as sa
from alembic import op

revision = "0120_memo_processing"
down_revision = "0119_workspace_telegram"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("hr_user_id", "accountant_user_id"):
        op.add_column("chairman_memoranda", sa.Column(name, sa.Uuid(), nullable=True))
        op.create_foreign_key("fk_memo_" + name, "chairman_memoranda", "core_users", [name], ["id"])
    for column in [
        sa.Column("document_script", sa.String(16)),
        sa.Column("hr_completed_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("order_file_name", sa.String(240)),
        sa.Column("order_content", sa.LargeBinary()),
        sa.Column("order_sha256", sa.String(64)),
    ]:
        op.add_column("chairman_memoranda", column)
    op.drop_constraint("ck_chairman_memo_status", "chairman_memoranda", type_="check")
    op.create_check_constraint(
        "ck_chairman_memo_status",
        "chairman_memoranda",
        "status IN ('draft','pending','approved','needs_revision','hr_pending',"
        "'accountant_pending','completed')",
    )
    op.create_check_constraint(
        "ck_memo_script",
        "chairman_memoranda",
        "document_script IS NULL OR document_script IN ('latin','cyrillic')",
    )
    op.create_check_constraint(
        "ck_memo_processing_actors",
        "chairman_memoranda",
        "status NOT IN ('hr_pending','accountant_pending','completed') OR "
        "(hr_user_id IS NOT NULL AND accountant_user_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_memo_order_required",
        "chairman_memoranda",
        "status NOT IN ('accountant_pending','completed') OR "
        "(order_content IS NOT NULL AND order_file_name IS NOT NULL AND order_sha256 IS NOT NULL)",
    )
    op.create_index("ix_memo_hr_inbox", "chairman_memoranda", ["hr_user_id", "status"])
    op.create_index(
        "ix_memo_accountant_inbox", "chairman_memoranda", ["accountant_user_id", "status"]
    )


def downgrade() -> None:
    raise RuntimeError(
        "Preserve memoranda, orders and audit history; disable the feature to roll back"
    )
