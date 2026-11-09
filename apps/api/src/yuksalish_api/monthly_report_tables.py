"""Monthly CA roster, immutable report revisions and one payroll authorization."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from .tables import metadata

cycles = sa.Table(
    "monthly_report_cycles",
    metadata,
    sa.Column("month", sa.Date(), primary_key=True),
    sa.Column("reminder_on", sa.Date(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("authorized_at", sa.DateTime(timezone=True)),
    sa.Column("authorized_by", UUID(as_uuid=True), sa.ForeignKey("core_users.id")),
    sa.Column("accountant_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id")),
    sa.Column("comment", sa.Text(), nullable=False, server_default=""),
    sa.Column("authorization_snapshot", sa.JSON(), nullable=False, server_default="{}"),
)
members = sa.Table(
    "monthly_report_members",
    metadata,
    sa.Column("month", sa.Date(), sa.ForeignKey(cycles.c.month), primary_key=True),
    sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), primary_key=True),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("department", sa.String(200), nullable=False),
)
reports = sa.Table(
    "monthly_reports",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("month", sa.Date(), nullable=False),
    sa.Column("user_id", UUID(as_uuid=True), nullable=False),
    sa.Column("revision", sa.Integer(), nullable=False),
    sa.Column("comment", sa.Text(), nullable=False),
    sa.Column("digest", sa.String(64), nullable=False),
    sa.Column("files", sa.JSON(), nullable=False),
    sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(["month", "user_id"], [members.c.month, members.c.user_id]),
    sa.UniqueConstraint("month", "user_id", "revision"),
    sa.CheckConstraint("revision > 0"),
)
calendar_days = sa.Table(
    "monthly_report_calendar",
    metadata,
    sa.Column("day", sa.Date(), primary_key=True),
    sa.Column("working", sa.Boolean(), nullable=False),
    sa.Column("note", sa.String(300), nullable=False),
    sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("core_users.id"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
)
