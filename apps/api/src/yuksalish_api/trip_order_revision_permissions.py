"""Document-only correction permissions; travel approval is never reopened."""

from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.engine import RowMapping

from .auth import AuthenticatedUser
from .workspace_schemas import TripAction

REVISION_ACTIONS = frozenset({
    "revise_order", "approve_revision", "complete_revision", "cancel_revision",
    "update_order_details",
})


def order_revision_actions(
    row: Mapping[str, object] | RowMapping, user: AuthenticatedUser,
    chair_id: UUID | None, hr_id: UUID | None,
) -> list[TripAction]:
    if row.get("status") != "approved" or row.get("deleted_at"):
        return []
    manager = user.role == "superadmin" or row.get("requester_user_id") == user.id
    stage = row.get("order_revision_stage")
    snapshot = row.get("order_revision_snapshot")
    data = snapshot if isinstance(snapshot, dict) else {}
    registration: list[TripAction] = []
    assigned_hr = str(user.id) == data.get("hrUserId") if stage == "hr" else user.id == hr_id
    if assigned_hr and row.get("order_pdf_key") and row.get("order_number"):
        registration.append("update_order_details")
    if stage is None:
        return [*registration, "revise_order"] if manager or user.id in {chair_id, hr_id} \
            else registration
    allowed: list[TripAction] = registration
    if stage == "chair" and user.id == chair_id:
        allowed.append("approve_revision")
    if stage == "hr" and str(user.id) == data.get("hrUserId"):
        allowed.append("complete_revision")
    if manager or user.id == chair_id or user.id == hr_id or str(user.id) == data.get("hrUserId"):
        allowed.append("cancel_revision")
    return allowed
