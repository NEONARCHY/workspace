"""Terminal reviewer rejection, distinct from author cancellation and revision."""

from alembic import op

revision = "0121_ai_referent_rejection"
down_revision = "0120_memo_processing"
branch_labels = None
depends_on = None

STATUSES = (
    "'draft','pending_review','needs_revision','approved','queued','sending','sent',"
    "'failed','cancelled','awaiting_final_send','referent_review_pending',"
    "'delivery_unknown','signed','operator_revision'"
)


def upgrade() -> None:
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint(
        "ck_ai_letters_status", "ai_referent_letters", f"status IN ({STATUSES},'rejected')"
    )


def downgrade() -> None:
    # Refuse rollback if it would lose the meaning of an existing rejection.
    op.execute(
        "SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM ai_referent_letters "
        "WHERE status = 'rejected') THEN 0 ELSE 1 END"
    )
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint(
        "ck_ai_letters_status", "ai_referent_letters", f"status IN ({STATUSES})"
    )
