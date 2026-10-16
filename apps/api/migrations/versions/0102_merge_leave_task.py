"""Join the independently reviewed leave and task-proposal migration branches."""

revision = "0102_merge_leave_task"
down_revision = ("0101_leave_approval", "0101_task_proposals")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
