"""Separate sign-only workflow without an outgoing number or delivery route."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053_ai_referent_sign_only"
down_revision: str | None = "0052_telegram_bot_access"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_referent_letters",
        sa.Column("workflow_kind", sa.String(16), nullable=False, server_default="delivery"),
    )
    op.create_check_constraint(
        "ck_ai_letters_workflow_kind",
        "ai_referent_letters",
        "workflow_kind IN ('delivery', 'sign_only')",
    )
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint(
        "ck_ai_letters_status",
        "ai_referent_letters",
        "status IN ('draft','pending_review','needs_revision','approved','queued','sending',"
        "'sent','failed','cancelled','awaiting_final_send','referent_review_pending',"
        "'delivery_unknown','signed')",
    )
    op.create_check_constraint(
        "ck_ai_sign_only_no_delivery",
        "ai_referent_letters",
        "workflow_kind <> 'sign_only' OR "
        "(outgoing_number IS NULL AND year_suffix IS NULL AND sent_at IS NULL "
        "AND status NOT IN ('approved','sent','awaiting_final_send',"
        "'referent_review_pending','delivery_unknown'))",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_sign_only_no_delivery", "ai_referent_letters", type_="check")
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint(
        "ck_ai_letters_status",
        "ai_referent_letters",
        "status IN ('draft','pending_review','needs_revision','approved','queued','sending',"
        "'sent','failed','cancelled','awaiting_final_send','referent_review_pending',"
        "'delivery_unknown')",
    )
    op.drop_constraint("ck_ai_letters_workflow_kind", "ai_referent_letters", type_="check")
    op.drop_column("ai_referent_letters", "workflow_kind")
