"""Object-level visibility shared by Workspace, Telegram and file downloads."""

from sqlalchemy.engine import RowMapping

from .auth import AuthenticatedUser

OPERATOR_VISIBLE_STATUSES = frozenset(
    {"referent_review_pending", "operator_revision", "delivery_unknown"}
)
PROGRESS_ONLY_STATUSES = frozenset(
    {
        "pending_review",
        "needs_revision",
        "approved",
        "queued",
        "sending",
        "awaiting_final_send",
        "failed",
    }
)


def may_view_letter(
    row: RowMapping, user: AuthenticatedUser, *, may_operate: bool = False
) -> bool:
    if row["status"] == "sent":
        return bool(
            row["created_by_user_id"] == user.id
            or user.role in {"manager", "admin", "superadmin"}
            or may_operate
        )
    return bool(
        row["created_by_user_id"] == user.id
        or row.get("reviewer_user_id") == user.id
        or row.get("final_reviewer_user_id") == user.id
        or row.get("initial_reviewer_user_id") == user.id
        or (may_operate and row["status"] in OPERATOR_VISIBLE_STATUSES)
    )
