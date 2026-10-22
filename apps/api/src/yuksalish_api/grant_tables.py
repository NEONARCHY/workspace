"""Separate grant records do not enter task completion or efficiency calculations."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from .tables import metadata, uuid_type

grant_settings = sa.Table(
    "grant_settings",
    metadata,
    sa.Column("id", sa.SmallInteger(), primary_key=True),
    sa.Column("leader_user_id", uuid_type),
    sa.Column("chair_user_id", uuid_type),
    sa.Column("revision", sa.Integer()),
    sa.Column("updated_by_user_id", uuid_type),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)
grant_requests = sa.Table(
    "grant_requests",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("creation_hash", sa.String(64)),
    sa.Column("title", sa.String(240)),
    sa.Column("description", sa.Text()),
    sa.Column("author_user_id", uuid_type),
    sa.Column("initiator_user_id", uuid_type),
    sa.Column("workflow_version", sa.SmallInteger()),
    sa.Column("launch_approved_at", sa.DateTime(timezone=True)),
    sa.Column("launch_approved_by_user_id", uuid_type),
    sa.Column("assignee_id", uuid_type),
    sa.Column("co_assignee_ids", postgresql.JSONB()),
    sa.Column("leader_user_id", uuid_type),
    sa.Column("chair_user_id", uuid_type),
    sa.Column("due_at", sa.DateTime(timezone=True)),
    sa.Column("status", sa.String(24)),
    sa.Column("revision", sa.Integer()),
    sa.Column("checklist", postgresql.JSONB()),
    sa.Column("result_text", sa.Text()),
    sa.Column("chat_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)
grant_events = sa.Table(
    "grant_events",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("grant_id", uuid_type),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("action", sa.String(32)),
    sa.Column("text", sa.Text()),
    sa.Column("from_status", sa.String(24)),
    sa.Column("to_status", sa.String(24)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)
