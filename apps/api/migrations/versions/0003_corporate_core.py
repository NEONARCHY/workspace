"""Create the corporate core, messenger, tasks and approval workflow schema.

Revision ID: 0003_corporate_core
Revises: 0002_hisobot_import_schema
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_corporate_core"
down_revision: str | None = "0002_hisobot_import_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "core_departments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_departments.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("code", name="uq_core_departments_code"),
    )
    op.create_table(
        "core_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=False),
        sa.Column("job_title", sa.String(length=160), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column(
            "department_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_departments.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "role IN ('superadmin', 'admin', 'manager', 'employee')",
            name="ck_core_users_role",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'blocked', 'archived')",
            name="ck_core_users_status",
        ),
        sa.UniqueConstraint("username", name="uq_core_users_username"),
    )

    op.create_table(
        "messenger_chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=True),
        sa.Column("context_type", sa.String(length=32), nullable=True),
        sa.Column("context_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('direct', 'group', 'department', 'project', 'task', 'approval')",
            name="ck_messenger_chats_kind",
        ),
    )
    op.create_table(
        "messenger_chat_members",
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_chats.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("member_role", sa.String(length=16), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("muted_until", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "member_role IN ('owner', 'moderator', 'member')",
            name="ck_messenger_chat_members_role",
        ),
    )
    op.create_table(
        "messenger_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "reply_to_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_messenger_messages_chat_created",
        "messenger_messages",
        ["chat_id", "created_at"],
    )
    op.create_table(
        "messenger_message_versions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("change_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "messenger_message_receipts",
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messenger_messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "tasks_cycles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("schedule_kind", sa.String(length=24), nullable=False),
        sa.Column("schedule_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "schedule_kind IN ('daily', 'weekly', 'monthly', 'calendar')",
            name="ck_tasks_cycles_schedule_kind",
        ),
    )
    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False),
        sa.Column(
            "author_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "primary_assignee_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "cycle_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks_cycles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cycle_occurrence_key", sa.String(length=96), nullable=True),
        sa.Column("project_key", sa.String(length=96), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('new', 'in_progress', 'awaiting_review', "
            "'completed', 'overdue', 'cancelled')",
            name="ck_tasks_status",
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'urgent')",
            name="ck_tasks_priority",
        ),
        sa.UniqueConstraint(
            "cycle_id",
            "cycle_occurrence_key",
            name="uq_tasks_cycle_occurrence",
        ),
    )
    op.create_index("ix_tasks_assignee_status", "tasks", ["primary_assignee_user_id", "status"])
    op.create_index("ix_tasks_due_at", "tasks", ["due_at"])
    op.create_table(
        "tasks_participants",
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("participant_role", sa.String(length=24), primary_key=True),
        sa.CheckConstraint(
            "participant_role IN ('co_assignee', 'observer')",
            name="ck_tasks_participants_role",
        ),
    )

    op.create_table(
        "approval_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("template_key", sa.String(length=96), nullable=False),
        sa.Column("name", sa.String(length=240), nullable=False),
        sa.Column("request_kind", sa.String(length=32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("form_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "request_kind IN ('payment', 'vacation', 'purchase', 'access', 'generic')",
            name="ck_approval_templates_request_kind",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'archived')",
            name="ck_approval_templates_status",
        ),
        sa.UniqueConstraint(
            "template_key",
            "version",
            name="uq_approval_templates_key_version",
        ),
    )
    op.create_table(
        "approval_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "template_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_key", sa.String(length=96), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('start', 'approval', 'condition', 'parallel', 'correction', 'end')",
            name="ck_approval_nodes_kind",
        ),
        sa.UniqueConstraint("template_id", "node_key", name="uq_approval_nodes_key"),
    )
    op.create_table(
        "approval_edges",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "template_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_node_key", sa.String(length=96), nullable=False),
        sa.Column("target_node_key", sa.String(length=96), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=True),
        sa.Column("condition", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "template_id",
            "source_node_key",
            "outcome",
            "sort_order",
            name="uq_approval_edges_route",
        ),
    )
    op.create_table(
        "approval_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "template_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_templates.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "requester_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("active_node_keys", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'running', 'needs_revision', 'approved', 'rejected', 'cancelled')",
            name="ck_approval_requests_status",
        ),
    )
    op.create_index(
        "ix_approval_requests_requester_status",
        "approval_requests",
        ["requester_user_id", "status"],
    )
    op.create_table(
        "approval_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_key", sa.String(length=96), nullable=False),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=24), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('approve', 'reject', 'return', 'clarify', 'delegate')",
            name="ck_approval_actions_action",
        ),
    )


def downgrade() -> None:
    op.drop_table("approval_actions")
    op.drop_index("ix_approval_requests_requester_status", table_name="approval_requests")
    op.drop_table("approval_requests")
    op.drop_table("approval_edges")
    op.drop_table("approval_nodes")
    op.drop_table("approval_templates")
    op.drop_table("tasks_participants")
    op.drop_index("ix_tasks_due_at", table_name="tasks")
    op.drop_index("ix_tasks_assignee_status", table_name="tasks")
    op.drop_table("tasks")
    op.drop_table("tasks_cycles")
    op.drop_table("messenger_message_receipts")
    op.drop_table("messenger_message_versions")
    op.drop_index("ix_messenger_messages_chat_created", table_name="messenger_messages")
    op.drop_table("messenger_messages")
    op.drop_table("messenger_chat_members")
    op.drop_table("messenger_chats")
    op.drop_table("core_users")
    op.drop_table("core_departments")
