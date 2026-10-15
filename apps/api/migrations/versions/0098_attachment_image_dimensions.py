"""Reserve image geometry before downloading attachment bytes.

Revision ID: 0098_attachment_image_dimensions
Revises: 0097_trip_deputy_approval
"""
import sqlalchemy as sa
from alembic import op

revision = "0098_attachment_image_dimensions"
down_revision = "0097_trip_deputy_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspace_attachments", sa.Column("image_width", sa.Integer(), nullable=True))
    op.add_column("workspace_attachments", sa.Column("image_height", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_attachments", "image_height")
    op.drop_column("workspace_attachments", "image_width")
