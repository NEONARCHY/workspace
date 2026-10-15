"""Pin trip deputy and keep withdrawn/deleted/annulled requests auditable.

Revision ID: 0098_trip_route_management
Revises: 0097_trip_deputy_approval
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0098_trip_route_management"
down_revision: str = "0097_trip_deputy_approval"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trip_requests", sa.Column("deputy_approver_user_id", sa.UUID(), nullable=True))
    op.add_column("trip_requests", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.create_foreign_key(
        "fk_trip_requests_deputy_approver", "trip_requests", "core_users",
        ["deputy_approver_user_id"], ["id"], ondelete="RESTRICT",
    )
    # Preserve the incumbent for already-running v3 trips when uniquely knowable.
    op.execute(sa.text("""
        WITH candidates AS (
            SELECT u.id FROM core_users AS u
            JOIN core_positions AS p ON p.id = u.position_id
            WHERE u.status = 'active' AND p.is_active = true
              AND p.name ILIKE 'Rais birinchi%'
        ), single_candidate AS (
            SELECT (SELECT id FROM candidates LIMIT 1) AS id
            WHERE (SELECT count(*) FROM candidates) = 1
        )
        UPDATE trip_requests AS trip
        SET deputy_approver_user_id = single_candidate.id
        FROM single_candidate
        WHERE trip.workflow_version = 3 AND trip.stage <> 'launch'
    """))
    op.drop_constraint("ck_trip_requests_status", "trip_requests", type_="check")
    op.create_check_constraint(
        "ck_trip_requests_status", "trip_requests",
        "status IN ('draft', 'running', 'needs_revision', 'approved', 'rejected', 'annulled')",
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text(
        "SELECT 1 FROM trip_requests WHERE status = 'annulled' OR deleted_at IS NOT NULL "
        "OR deputy_approver_user_id IS NOT NULL LIMIT 1"
    )).first():
        raise RuntimeError("Restore deleted and annulled trips before downgrading")
    op.drop_constraint("ck_trip_requests_status", "trip_requests", type_="check")
    op.create_check_constraint(
        "ck_trip_requests_status", "trip_requests",
        "status IN ('draft', 'running', 'needs_revision', 'approved', 'rejected')",
    )
    op.drop_constraint("fk_trip_requests_deputy_approver", "trip_requests", type_="foreignkey")
    op.drop_column("trip_requests", "deleted_at")
    op.drop_column("trip_requests", "deputy_approver_user_id")
