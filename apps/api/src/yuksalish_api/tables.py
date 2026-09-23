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
    sa.Column("locale", sa.String(16)),
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

module_access_rules = sa.Table(
    "core_module_access_rules",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("subject_type", sa.String(16)),
    sa.Column("subject_key", sa.String(96)),
    sa.Column("module_key", sa.String(64)),
    sa.Column("permissions", postgresql.JSONB()),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
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
    sa.Column("direct_manager_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("failed_login_count", sa.Integer()),
    sa.Column("locked_until", sa.DateTime(timezone=True)),
    sa.Column("password_changed_at", sa.DateTime(timezone=True)),
    sa.Column("avatar_storage_key", sa.String(500)),
    sa.Column("avatar_content_type", sa.String(80)),
    sa.Column("avatar_updated_at", sa.DateTime(timezone=True)),
)

update_releases = sa.Table(
    "workspace_update_releases", metadata,
    sa.Column("version", sa.String(32), primary_key=True),
    sa.Column("title", sa.String(120)),
    sa.Column("notes", postgresql.JSONB()),
    sa.Column("file_name", sa.String(160)),
    sa.Column("sha512", sa.String(128)),
    sa.Column("size_bytes", sa.BigInteger()),
    sa.Column("uploaded_by_user_id", uuid_type),
    sa.Column("uploaded_at", sa.DateTime(timezone=True)),
    sa.Column("published_at", sa.DateTime(timezone=True)),
)

update_policy = sa.Table(
    "workspace_update_policy", metadata,
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("published_version", sa.String(32)),
    sa.Column("minimum_version", sa.String(32)),
    sa.Column("mandatory", sa.Boolean()),
    sa.Column("updated_by_user_id", uuid_type),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
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

admin_chat_inspections = sa.Table(
    "messenger_admin_inspections",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("chat_id", uuid_type),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("reason", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("expires_at", sa.DateTime(timezone=True)),
    sa.Column("last_accessed_at", sa.DateTime(timezone=True)),
    sa.Column("revoked_at", sa.DateTime(timezone=True)),
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
    sa.Column("client_kind", sa.String(16), nullable=False, server_default="desktop"),
    sa.Column("csrf_token_hash", sa.String(64), nullable=True),
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
    sa.Column("deleted_at", sa.DateTime(timezone=True)),
    sa.Column("deleted_by_user_id", uuid_type),
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
    sa.Column("calendar_event_id", uuid_type),
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

task_comment_reactions = sa.Table(
    "task_comment_reactions",
    metadata,
    sa.Column("comment_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("emoji", sa.String(16), primary_key=True),
    sa.Column("created_at", sa.DateTime(timezone=True)),
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
    sa.Column("calendar_event_id", uuid_type),
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

absence_requests = sa.Table(
    "absence_requests",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("requester_user_id", uuid_type),
    sa.Column("direct_manager_user_id", uuid_type),
    sa.Column("kind", sa.String(32)),
    sa.Column("reason", sa.Text()),
    sa.Column("starts_at", sa.DateTime(timezone=True)),
    sa.Column("ends_at", sa.DateTime(timezone=True)),
    sa.Column("status", sa.String(24)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

absence_request_actions = sa.Table(
    "absence_request_actions",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("request_id", uuid_type),
    sa.Column("actor_user_id", uuid_type),
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
    sa.Column("parent_comment_id", uuid_type),
    sa.Column("body", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

feed_comment_reactions = sa.Table(
    "feed_comment_reactions",
    metadata,
    sa.Column("comment_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("emoji", sa.String(16), primary_key=True),
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
    sa.Column("status", sa.String(16)),
    sa.Column("responded_at", sa.DateTime(timezone=True)),
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
    sa.Column("absences_enabled", sa.Boolean()),
    sa.Column("zoom_enabled", sa.Boolean()),
    sa.Column("reminders_enabled", sa.Boolean()),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

# HR service-tenure records deliberately live outside ``core_users``: an employee's
# account can be archived without losing statutory personnel history.
hr_settings = sa.Table(
    "hr_settings", metadata,
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("hr_user_id", uuid_type),
    sa.Column("chair_user_id", uuid_type),
    sa.Column("accountant_user_id", uuid_type),
    sa.Column("updated_by_user_id", uuid_type),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

hr_employee_profiles = sa.Table(
    "hr_employee_profiles", metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, unique=True),
    sa.Column("full_name", sa.String(200)),
    sa.Column("job_title", sa.String(160)),
    sa.Column("import_key", sa.String(200), unique=True),
    sa.Column("employment_date", sa.Date()),
    sa.Column("service_anchor_date", sa.Date()),
    sa.Column("service_years", sa.Integer()),
    sa.Column("service_months", sa.Integer()),
    sa.Column("service_days", sa.Integer()),
    sa.Column("service_reason", sa.Text()),
    sa.Column("employment_status", sa.String(24)),
    sa.Column("terminated_on", sa.Date()),
    sa.Column("termination_reason", sa.Text()),
    sa.Column("hidden_after_year", sa.Boolean()),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

hr_service_history = sa.Table(
    "hr_service_history", metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("profile_id", uuid_type),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("service_anchor_date", sa.Date()),
    sa.Column("service_years", sa.Integer()),
    sa.Column("service_months", sa.Integer()),
    sa.Column("service_days", sa.Integer()),
    sa.Column("reason", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

hr_monthly_registers = sa.Table(
    "hr_monthly_registers", metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("period", sa.String(7)),
    sa.Column("version", sa.Integer()),
    sa.Column("status", sa.String(32)),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("submitted_at", sa.DateTime(timezone=True)),
    sa.Column("approved_at", sa.DateTime(timezone=True)),
    sa.Column("accounted_at", sa.DateTime(timezone=True)),
    sa.Column("return_comment", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

hr_monthly_register_items = sa.Table(
    "hr_monthly_register_items", metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("register_id", uuid_type),
    sa.Column("user_id", uuid_type),
    sa.Column("full_name", sa.String(200)),
    sa.Column("job_title", sa.String(160)),
    sa.Column("service_years", sa.Integer()),
    sa.Column("service_months", sa.Integer()),
    sa.Column("service_days", sa.Integer()),
    sa.Column("allowance_percent", sa.Numeric(5, 2)),
)

zoom_meetings = sa.Table(
    "zoom_meetings",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("organizer_user_id", uuid_type),
    sa.Column("organizer_display_name", sa.String(240)),
    sa.Column("topic", sa.String(200)),
    sa.Column("description", sa.Text()),
    sa.Column("starts_at", sa.DateTime(timezone=True)),
    sa.Column("ends_at", sa.DateTime(timezone=True)),
    sa.Column("duration_minutes", sa.Integer()),
    sa.Column("timezone", sa.String(64)),
    sa.Column("zoom_meeting_id", sa.String(64)),
    sa.Column("join_url", sa.Text()),
    sa.Column("passcode", sa.String(64)),
    sa.Column("status", sa.String(24)),
    sa.Column("source", sa.String(16)),
    sa.Column("reminders_enabled", sa.Boolean()),
    sa.Column("technical_error", sa.String(120)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

zoom_meeting_participants = sa.Table(
    "zoom_meeting_participants",
    metadata,
    sa.Column("meeting_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type, primary_key=True),
)

ai_referent_letters = sa.Table(
    "ai_referent_letters",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("outgoing_number", sa.Integer()),
    sa.Column("year_suffix", sa.String(2)),
    sa.Column("subject", sa.String(300)),
    sa.Column("recipient_organization", sa.String(300)),
    sa.Column("recipient_address", sa.String(500)),
    sa.Column("route", sa.String(16)),
    sa.Column("note", sa.Text()),
    sa.Column("status", sa.String(32)),
    sa.Column("source", sa.String(24)),
    sa.Column("created_by_user_id", uuid_type),
    sa.Column("reviewer_user_id", uuid_type),
    sa.Column("reviewer_key", sa.String(32)),
    sa.Column("final_reviewer_user_id", uuid_type),
    sa.Column("final_reviewer_key", sa.String(32)),
    sa.Column("initial_reviewer_user_id", uuid_type),
    sa.Column("initial_reviewer_key", sa.String(32)),
    sa.Column("delivery_error", sa.Text()),
    sa.Column("legacy_id", sa.String(128)),
    sa.Column("revision", sa.Integer()),
    sa.Column("sent_at", sa.DateTime(timezone=True)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

ai_referent_number_counters = sa.Table(
    "ai_referent_number_counters",
    metadata,
    sa.Column("year_suffix", sa.String(2), primary_key=True),
    sa.Column("last_number", sa.Integer()),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

ai_referent_events = sa.Table(
    "ai_referent_events",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("letter_id", uuid_type),
    sa.Column("actor_user_id", uuid_type),
    sa.Column("event_type", sa.String(64)),
    sa.Column("from_status", sa.String(32)),
    sa.Column("to_status", sa.String(32)),
    sa.Column("comment", sa.Text()),
    sa.Column("metadata", postgresql.JSONB()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

ai_referent_delivery_commands = sa.Table(
    "ai_referent_delivery_commands",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("letter_id", uuid_type),
    sa.Column("route", sa.String(16)),
    sa.Column("status", sa.String(24)),
    sa.Column("idempotency_key", sa.String(160)),
    sa.Column("kind", sa.String(16)),
    sa.Column("lease_token", uuid_type),
    sa.Column("result", postgresql.JSONB()),
    sa.Column("claimed_by", sa.String(160)),
    sa.Column("lease_until", sa.DateTime(timezone=True)),
    sa.Column("attempt_count", sa.Integer()),
    sa.Column("last_error", sa.Text()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("completed_at", sa.DateTime(timezone=True)),
)

ai_referent_agents = sa.Table(
    "ai_referent_agents",
    metadata,
    sa.Column("agent_id", sa.String(128), primary_key=True),
    sa.Column("display_name", sa.String(200)),
    sa.Column("last_seen_at", sa.DateTime(timezone=True)),
    sa.Column("configuration_revision", sa.Integer()),
    sa.Column("configuration_applied_at", sa.DateTime(timezone=True)),
    sa.Column("configuration_error", sa.String(500)),
    sa.Column("journal_storage_key", sa.String(500)),
    sa.Column("journal_file_name", sa.String(255)),
    sa.Column("journal_content_type", sa.String(160)),
    sa.Column("journal_byte_size", sa.BigInteger()),
    sa.Column("journal_sha256", sa.String(64)),
    sa.Column("journal_updated_at", sa.DateTime(timezone=True)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

ai_referent_incoming_letters = sa.Table(
    "ai_referent_incoming_letters",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("agent_id", sa.String(128)),
    sa.Column("external_id", sa.String(160)),
    sa.Column("sequence_number", sa.String(32)),
    sa.Column("platform_incoming_number", sa.String(80)),
    sa.Column("sender_letter_number", sa.String(160)),
    sa.Column("platform_incoming_date", sa.Date()),
    sa.Column("platform_outgoing_date", sa.Date()),
    sa.Column("received_at", sa.DateTime(timezone=True)),
    sa.Column("processed_at", sa.DateTime(timezone=True)),
    sa.Column("registered_at", sa.DateTime(timezone=True)),
    sa.Column("sender_organization", sa.String(300)),
    sa.Column("sender_person", sa.String(300)),
    sa.Column("subject", sa.String(500)),
    sa.Column("responsible_external_id", sa.String(160)),
    sa.Column("responsible_display_name", sa.String(300)),
    sa.Column("responsible_user_id", uuid_type),
    sa.Column("urgency", sa.String(32)),
    sa.Column("has_attachments", sa.Boolean()),
    sa.Column("attachments_count", sa.Integer()),
    sa.Column("main_document_filename", sa.String(500)),
    sa.Column("platform_record_id", sa.String(160)),
    sa.Column("status", sa.String(64)),
    sa.Column("fallback_used", sa.Boolean()),
    sa.Column("error_message", sa.Text()),
    sa.Column("source", sa.String(24)),
    sa.Column("payload_sha256", sa.String(64)),
    sa.Column("revision", sa.Integer()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

ai_referent_configuration = sa.Table(
    "ai_referent_configuration", metadata,
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("revision", sa.Integer()),
    sa.Column("execution_agent_id", sa.String(128)),
    sa.Column("updated_by_user_id", uuid_type),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

ai_referent_reviewers = sa.Table(
    "ai_referent_reviewers", metadata,
    sa.Column("key", sa.String(32), primary_key=True),
    sa.Column("label", sa.String(160)),
    sa.Column("suggested_username", sa.String(64)),
    sa.Column("user_id", uuid_type),
    sa.Column("telegram_id", sa.String(20)),
    sa.Column("enabled", sa.Boolean()),
)

ai_referent_telegram_links = sa.Table(
    "ai_referent_telegram_links", metadata,
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("telegram_id", sa.String(20)),
    sa.Column("code_hash", sa.String(64)),
    sa.Column("code_expires_at", sa.DateTime(timezone=True)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

ai_referent_operations = sa.Table(
    "ai_referent_operations", metadata,
    sa.Column("operation_id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("fingerprint", sa.String(64)),
    sa.Column("letter_id", uuid_type),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

ai_referent_telegram_outbox = sa.Table(
    "ai_referent_telegram_outbox", metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("letter_id", uuid_type),
    sa.Column("event_key", sa.String(160)),
    sa.Column("text", sa.Text()),
    sa.Column("lease_token", uuid_type),
    sa.Column("lease_until", sa.DateTime(timezone=True)),
    sa.Column("delivered_at", sa.DateTime(timezone=True)),
    sa.Column("attempt_count", sa.Integer()),
    sa.Column("last_error", sa.String(500)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

ai_referent_archive = sa.Table(
    "ai_referent_archive", metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("agent_id", sa.String(128)),
    sa.Column("external_id", sa.String(160)),
    sa.Column("payload", postgresql.JSONB()),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

ai_referent_files = sa.Table(
    "ai_referent_files", metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("kind", sa.String(16)),
    sa.Column("owner_id", uuid_type),
    sa.Column("relative_path", sa.String(500)),
    sa.Column("storage_key", sa.String(600)),
    sa.Column("sha256", sa.String(64)),
    sa.Column("byte_size", sa.BigInteger()),
    sa.Column("content_type", sa.String(160)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)
