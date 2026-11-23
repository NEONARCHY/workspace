"""Join incoming execution and the independently released notification mirror."""

revision = "0128_merge_incoming_telegram"
down_revision = ("0127_incoming_document_execution", "0127_notification_mirror")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
