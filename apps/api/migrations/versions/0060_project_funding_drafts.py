"""Allow private project funding drafts while attachments are uploaded."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0060_project_funding_drafts"
down_revision: str = "0059_project_workstream_details"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_project_hub_request_status", "project_hub_requests", type_="check")
    op.create_check_constraint(
        "ck_project_hub_request_status", "project_hub_requests",
        "status IN ('draft','pending','approved','rejected')",
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM project_hub_requests WHERE status = 'draft')"
    )):
        raise RuntimeError("Submit or export project funding drafts before downgrading")
    op.drop_constraint("ck_project_hub_request_status", "project_hub_requests", type_="check")
    op.create_check_constraint(
        "ck_project_hub_request_status", "project_hub_requests",
        "status IN ('pending','approved','rejected')",
    )
