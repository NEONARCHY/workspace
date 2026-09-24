"""Isolated administrator replacement stage, never author-accessible approval bypass."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0054_ai_referent_operator_edit"
down_revision: str | None = "0053_ai_referent_sign_only"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BASE = (
    "'draft','pending_review','needs_revision','approved','queued','sending','sent',"
    "'failed','cancelled','awaiting_final_send','referent_review_pending','delivery_unknown','signed'"
)


def upgrade() -> None:
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint(
        "ck_ai_letters_status", "ai_referent_letters", f"status IN ({BASE},'operator_revision')"
    )
    op.create_check_constraint(
        "ck_ai_operator_delivery_only",
        "ai_referent_letters",
        "status <> 'operator_revision' OR workflow_kind = 'delivery'",
    )


def downgrade() -> None:
    # Do not silently discard an administrator's unfinished replacement.
    op.execute(
        sa.text(
            "SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM ai_referent_letters "
            "WHERE status = 'operator_revision') THEN 0 ELSE 1 END"
        )
    )
    op.drop_constraint("ck_ai_operator_delivery_only", "ai_referent_letters", type_="check")
    op.drop_constraint("ck_ai_letters_status", "ai_referent_letters", type_="check")
    op.create_check_constraint("ck_ai_letters_status", "ai_referent_letters", f"status IN ({BASE})")
