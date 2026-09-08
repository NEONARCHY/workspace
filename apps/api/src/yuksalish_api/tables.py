import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

metadata = sa.MetaData()
uuid_type = postgresql.UUID(as_uuid=True)

personal_preferences = sa.Table(
    "workspace_personal_preferences", metadata,
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("pinned_chat_ids", postgresql.JSONB()),
    sa.Column("archived_chat_ids", postgresql.JSONB()),
    sa.Column("navigation_order", postgresql.JSONB()),
    sa.Column("revision", sa.Integer()),
)

departments = sa.Table(
    "core_departments",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("code", sa.String(64)),
    sa.Column("name", sa.String(200)),
    sa.Column("parent_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

positions = sa.Table(
    "core_positions",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("name", sa.String(160)),
    sa.Column("is_active", sa.Boolean()),
    sa.Column("sort_order", sa.Integer()),
    sa.Column("source", sa.String(32)),
    sa.Column("aliases", postgresql.JSONB()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

users = sa.Table(
    "core_users",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("username", sa.String(64)),
    sa.Column("full_name", sa.String(200)),
    sa.Column("job_title", sa.String(160)),
    sa.Column("password_hash", sa.Text()),
    sa.Column("role", sa.String(24)),
    sa.Column("status", sa.String(24)),
    sa.Column("department_id", uuid_type),
    sa.Column("position_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("failed_login_count", sa.Integer()),
    sa.Column("locked_until", sa.DateTime(timezone=True)),
    sa.Column("password_changed_at", sa.DateTime(timezone=True)),
)

audit_events = sa.Table(
    "core_audit_events",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("action", sa.String(96)),
    sa.Column("target_type", sa.String(64)),
    sa.Column("target_id", uuid_type),
    sa.Column("details", postgresql.JSONB()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

auth_invitations = sa.Table(
    "auth_invitations",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("invited_by_user_id", uuid_type),
    sa.Column("token_hash", sa.String(64)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("expires_at", sa.DateTime(timezone=True)),
    sa.Column("accepted_at", sa.DateTime(timezone=True)),
    sa.Column("revoked_at", sa.DateTime(timezone=True)),
)

auth_sessions = sa.Table(
    "auth_sessions",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("refresh_token_hash", sa.String(64)),
    sa.Column("device_label", sa.String(160)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("expires_at", sa.DateTime(timezone=True)),
    sa.Column("last_seen_at", sa.DateTime(timezone=True)),
    sa.Column("revoked_at", sa.DateTime(timezone=True)),
)

auth_totp_factors = sa.Table(
    "auth_totp_factors",
    metadata,
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("secret_ciphertext", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("confirmed_at", sa.DateTime(timezone=True)),
    sa.Column("last_used_step", sa.BigInteger()),
)

auth_password_resets = sa.Table(
    "auth_password_resets",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("issued_by_user_id", uuid_type),
    sa.Column("token_hash", sa.String(64)),
    sa.Column("reset_totp", sa.Boolean()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("expires_at", sa.DateTime(timezone=True)),
    sa.Column("consumed_at", sa.DateTime(timezone=True)),
    sa.Column("revoked_at", sa.DateTime(timezone=True)),
)

chats = sa.Table(
    "messenger_chats",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("kind", sa.String(24)),
    sa.Column("direct_key", sa.String(73)),
    sa.Column("description", sa.Text()),
    sa.Column("title", sa.String(240)),
    sa.Column("context_type", sa.String(32)),
    sa.Column("context_id", uuid_type),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

chat_members = sa.Table(
    "messenger_chat_members",
    metadata,
    sa.Column("chat_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("member_role", sa.String(16)),
    sa.Column("permissions", postgresql.JSONB()),
    sa.Column("joined_at", sa.DateTime(timezone=True)),
    sa.Column("muted_until", sa.DateTime(timezone=True)),
)

messages = sa.Table(
    "messenger_messages",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("chat_id", uuid_type),
    sa.Column("author_user_id", uuid_type),
    sa.Column("reply_to_message_id", uuid_type),
    sa.Column("revision", sa.Integer()),
    sa.Column("mention_user_ids", postgresql.JSONB()),
    sa.Column("body", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("edited_at", sa.DateTime(timezone=True)),
    sa.Column("deleted_at", sa.DateTime(timezone=True)),
)

message_receipts = sa.Table(
    "messenger_message_receipts",
    metadata,
    sa.Column("message_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("delivered_at", sa.DateTime(timezone=True)),
    sa.Column("read_at", sa.DateTime(timezone=True)),
)

message_reactions = sa.Table(
    "messenger_message_reactions",
    metadata,
    sa.Column("message_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("emoji", sa.String(8), primary_key=True),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

pinned_messages = sa.Table(
    "messenger_pinned_messages",
    metadata,
    sa.Column("message_id", uuid_type, primary_key=True),
    sa.Column("chat_id", uuid_type),
    sa.Column("pinned_by_user_id", uuid_type),
    sa.Column("pinned_at", sa.DateTime(timezone=True)),
)

attachments = sa.Table(
    "workspace_attachments",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("owner_type", sa.String(32)),
    sa.Column("owner_id", uuid_type),
    sa.Column("file_name", sa.String(255)),
    sa.Column("content_type", sa.String(160)),
    sa.Column("byte_size", sa.BigInteger()),
    sa.Column("sha256", sa.String(64)),
    sa.Column("storage_key", sa.String(500)),
    sa.Column("uploaded_by_user_id", uuid_type),
    sa.Column("document_role", sa.String(24)),
    sa.Column("media_kind", sa.String(16)),
    sa.Column("media_duration_ms", sa.Integer()),
    sa.Column("media_codec", sa.String(32)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

message_versions = sa.Table(
    "messenger_message_versions",
    metadata,
    sa.Column("id", sa.BigInteger(), primary_key=True),
    sa.Column("message_id", uuid_type),
    sa.Column("body", sa.Text()),
    sa.Column("mention_user_ids", postgresql.JSONB()),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("change_reason", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

tasks = sa.Table(
    "tasks",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("title", sa.String(240)),
    sa.Column("description", sa.Text()),
    sa.Column("status", sa.String(24)),
    sa.Column("priority", sa.String(16)),
    sa.Column("author_user_id", uuid_type),
    sa.Column("primary_assignee_user_id", uuid_type),
    sa.Column("parent_task_id", uuid_type),
    sa.Column("cycle_id", uuid_type),
    sa.Column("cycle_occurrence_key", sa.String(96)),
    sa.Column("project_key", sa.String(96)),
    sa.Column("starts_at", sa.DateTime(timezone=True)),
    sa.Column("due_at", sa.DateTime(timezone=True)),
    sa.Column("result_text", sa.Text()),
    sa.Column("source_message_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

employee_efficiency_methodologies = sa.Table(
    "employee_efficiency_methodologies",
    metadata,
    sa.Column("version", sa.String(32), primary_key=True),
    sa.Column("timezone", sa.String(64)),
    sa.Column("tracking_started_at", sa.DateTime(timezone=True)),
    sa.Column("rules", postgresql.JSONB()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

task_efficiency_events = sa.Table(
    "task_efficiency_events",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("task_id", uuid_type),
    sa.Column("event_type", sa.String(48)),
    sa.Column("occurred_at", sa.DateTime(timezone=True)),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("assignee_user_id", uuid_type),
    sa.Column("due_at", sa.DateTime(timezone=True)),
    sa.Column("old_value", postgresql.JSONB()),
    sa.Column("new_value", postgresql.JSONB()),
    sa.Column("reason_code", sa.String(48)),
    sa.Column("reason_text", sa.Text()),
    sa.Column("metadata", postgresql.JSONB()),
    sa.Column("methodology_version", sa.String(32)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

employee_efficiency_snapshots = sa.Table(
    "employee_efficiency_snapshots",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("snapshot_date", sa.Date()),
    sa.Column("period", sa.String(7)),
    sa.Column("percentage", sa.Numeric(7, 3)),
    sa.Column("on_time_count", sa.Integer()),
    sa.Column("eligible_count", sa.Integer()),
    sa.Column("overdue_count", sa.Integer()),
    sa.Column("methodology_version", sa.String(32)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

task_cycles = sa.Table(
    "tasks_cycles",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("title", sa.String(240)),
    sa.Column("schedule_kind", sa.String(24)),
    sa.Column("schedule_config", postgresql.JSONB()),
    sa.Column("timezone", sa.String(64)),
    sa.Column("next_run_at", sa.DateTime(timezone=True)),
    sa.Column("is_enabled", sa.Boolean()),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

task_participants = sa.Table(
    "tasks_participants",
    metadata,
    sa.Column("task_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("participant_role", sa.String(24), primary_key=True),
)

task_checklist_items = sa.Table(
    "task_checklist_items",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("task_id", uuid_type),
    sa.Column("title", sa.String(500)),
    sa.Column("is_completed", sa.Boolean()),
    sa.Column("sort_order", sa.Integer()),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("completed_by_user_id", uuid_type),
    sa.Column("completed_at", sa.DateTime(timezone=True)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

task_comments = sa.Table(
    "task_comments",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("task_id", uuid_type),
    sa.Column("author_user_id", uuid_type),
    sa.Column("body", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("edited_at", sa.DateTime(timezone=True)),
)

task_dependencies = sa.Table(
    "task_dependencies",
    metadata,
    sa.Column("task_id", uuid_type, primary_key=True),
    sa.Column("depends_on_task_id", uuid_type, primary_key=True),
    sa.Column("dependency_kind", sa.String(24)),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

approval_templates = sa.Table(
    "approval_templates",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("template_key", sa.String(96)),
    sa.Column("name", sa.String(240)),
    sa.Column("request_kind", sa.String(32)),
    sa.Column("version", sa.Integer()),
    sa.Column("status", sa.String(16)),
    sa.Column("form_schema", postgresql.JSONB()),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("published_at", sa.DateTime(timezone=True)),
)

approval_nodes = sa.Table(
    "approval_nodes",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("template_id", uuid_type),
    sa.Column("node_key", sa.String(96)),
    sa.Column("kind", sa.String(24)),
    sa.Column("title", sa.String(240)),
    sa.Column("config", postgresql.JSONB()),
    sa.Column("position_x", sa.Float()),
    sa.Column("position_y", sa.Float()),
)

approval_edges = sa.Table(
    "approval_edges",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("template_id", uuid_type),
    sa.Column("source_node_key", sa.String(96)),
    sa.Column("target_node_key", sa.String(96)),
    sa.Column("outcome", sa.String(32)),
    sa.Column("label", sa.String(160)),
    sa.Column("condition", postgresql.JSONB()),
    sa.Column("sort_order", sa.Integer()),
)

approval_requests = sa.Table(
    "approval_requests",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("template_id", uuid_type),
    sa.Column("requester_user_id", uuid_type),
    sa.Column("responsible_user_id", uuid_type),
    sa.Column("title", sa.String(240)),
    sa.Column("payload", postgresql.JSONB()),
    sa.Column("status", sa.String(24)),
    sa.Column("active_node_keys", postgresql.JSONB()),
    sa.Column("actor_overrides", postgresql.JSONB()),
    sa.Column("source_task_id", uuid_type),
    sa.Column("current_version", sa.Integer()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("finished_at", sa.DateTime(timezone=True)),
)

approval_request_versions = sa.Table(
    "approval_request_versions",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("request_id", uuid_type),
    sa.Column("version", sa.Integer()),
    sa.Column("title", sa.String(240)),
    sa.Column("payload", postgresql.JSONB()),
    sa.Column("attachment_ids", postgresql.JSONB()),
    sa.Column("edited_by_user_id", uuid_type),
    sa.Column("change_reason", sa.String(48)),
    sa.Column("change_comment", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

approval_actions = sa.Table(
    "approval_actions",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("request_id", uuid_type),
    sa.Column("node_key", sa.String(96)),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("delegated_to_user_id", uuid_type),
    sa.Column("action", sa.String(24)),
    sa.Column("comment", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

approval_deadline_events = sa.Table(
    "approval_deadline_events",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("request_id", uuid_type),
    sa.Column("recipient_user_id", uuid_type),
    sa.Column("node_key", sa.String(96)),
    sa.Column("event_type", sa.String(32)),
    sa.Column("recipient_role", sa.String(32)),
    sa.Column("threshold_hours", sa.Integer()),
    sa.Column("deadline_at", sa.DateTime(timezone=True)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

workspace_projects = sa.Table(
    "workspace_projects",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("code", sa.String(48)),
    sa.Column("title", sa.String(240)),
    sa.Column("description", sa.Text()),
    sa.Column("manager_user_id", uuid_type),
    sa.Column("start_date", sa.Date()),
    sa.Column("end_date", sa.Date()),
    sa.Column("budget", sa.BigInteger()),
    sa.Column("spent_budget", sa.BigInteger()),
    sa.Column("currency", sa.String(3)),
    sa.Column("status", sa.String(24)),
    sa.Column("stage", sa.String(24)),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

project_stage_actions = sa.Table(
    "project_stage_actions",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("project_id", uuid_type),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("from_stage", sa.String(24)),
    sa.Column("to_stage", sa.String(24)),
    sa.Column("action", sa.String(24)),
    sa.Column("comment", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

trip_requests = sa.Table(
    "trip_requests",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("requester_user_id", uuid_type),
    sa.Column("purpose", sa.Text()),
    sa.Column("destination", sa.String(240)),
    sa.Column("start_date", sa.Date()),
    sa.Column("end_date", sa.Date()),
    sa.Column("stage", sa.String(32)),
    sa.Column("status", sa.String(24)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("finished_at", sa.DateTime(timezone=True)),
)

trip_request_employees = sa.Table(
    "trip_request_employees",
    metadata,
    sa.Column("request_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
)

trip_request_actions = sa.Table(
    "trip_request_actions",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("request_id", uuid_type),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("from_stage", sa.String(32)),
    sa.Column("to_stage", sa.String(32)),
    sa.Column("action", sa.String(24)),
    sa.Column("comment", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

feed_posts = sa.Table(
    "feed_posts",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("author_user_id", uuid_type),
    sa.Column("title", sa.String(240)),
    sa.Column("body", sa.Text()),
    sa.Column("is_pinned", sa.Boolean()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

feed_comments = sa.Table(
    "feed_comments",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("post_id", uuid_type),
    sa.Column("author_user_id", uuid_type),
    sa.Column("body", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

feed_reactions = sa.Table(
    "feed_reactions",
    metadata,
    sa.Column("post_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("kind", sa.String(16)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

calendar_events = sa.Table(
    "calendar_events",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("organizer_user_id", uuid_type),
    sa.Column("title", sa.String(240)),
    sa.Column("description", sa.Text()),
    sa.Column("event_type", sa.String(24)),
    sa.Column("starts_at", sa.DateTime(timezone=True)),
    sa.Column("ends_at", sa.DateTime(timezone=True)),
    sa.Column("all_day", sa.Boolean()),
    sa.Column("location", sa.String(240)),
    sa.Column("status", sa.String(16)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

calendar_event_attendees = sa.Table(
    "calendar_event_attendees",
    metadata,
    sa.Column("event_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
)

workspace_notifications = sa.Table(
    "workspace_notifications",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("event_key", sa.String(320)),
    sa.Column("kind", sa.String(24)),
    sa.Column("priority", sa.String(16)),
    sa.Column("title", sa.String(240)),
    sa.Column("body", sa.Text()),
    sa.Column("section", sa.String(32)),
    sa.Column("entity_id", uuid_type),
    sa.Column("requires_action", sa.Boolean()),
    sa.Column("is_reminder", sa.Boolean()),
    sa.Column("occurred_at", sa.DateTime(timezone=True)),
    sa.Column("read_at", sa.DateTime(timezone=True)),
    sa.Column("resolved_at", sa.DateTime(timezone=True)),
    sa.Column("desktop_delivered_at", sa.DateTime(timezone=True)),
)

workspace_notification_preferences = sa.Table(
    "workspace_notification_preferences",
    metadata,
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("desktop_enabled", sa.Boolean()),
    sa.Column("messages_enabled", sa.Boolean()),
    sa.Column("tasks_enabled", sa.Boolean()),
    sa.Column("approvals_enabled", sa.Boolean()),
    sa.Column("trips_enabled", sa.Boolean()),
    sa.Column("calendar_enabled", sa.Boolean()),
    sa.Column("reminders_enabled", sa.Boolean()),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)
