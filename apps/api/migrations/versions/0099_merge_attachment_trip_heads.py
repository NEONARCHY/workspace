"""Merge independently published attachment and trip metadata branches.

Revision ID: 0099_merge_attachment_trip_heads
Revises: 0098_attachment_image_dimensions, 0098_trip_route_management
"""

revision = "0099_merge_attachment_trip_heads"
down_revision = ("0098_attachment_image_dimensions", "0098_trip_route_management")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
