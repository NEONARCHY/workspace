"""Private mail data is separate from shared letters, tasks and attachments."""

import sqlalchemy as sa

from .tables import metadata, uuid_type

mail_accounts = sa.Table(
    "mail_accounts",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("owner_user_id", uuid_type),
    sa.Column("email", sa.String(254)),
    sa.Column("refresh_cipher", sa.Text()),
    sa.Column("access_cipher", sa.Text()),
    sa.Column("access_expires_at", sa.DateTime(timezone=True)),
    sa.Column("reconnect_required", sa.Boolean()),
    sa.Column("connected_at", sa.DateTime(timezone=True)),
)

mail_oauth_requests = sa.Table(
    "mail_oauth_requests",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("owner_user_id", uuid_type),
    sa.Column("state_hash", sa.String(64)),
    sa.Column("verifier_cipher", sa.Text()),
    sa.Column("status", sa.String(16)),
    sa.Column("expires_at", sa.DateTime(timezone=True)),
)

mail_drafts = sa.Table(
    "mail_drafts",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("owner_user_id", uuid_type),
    sa.Column("account_id", uuid_type),
    sa.Column("payload_cipher", sa.Text()),
    sa.Column("reply_message_id", sa.String(200)),
    sa.Column("reply_cipher", sa.Text()),
    sa.Column("status", sa.String(16)),
    sa.Column("revision", sa.Integer()),
    sa.Column("operation_id", uuid_type),
    sa.Column("provider_message_id", sa.String(200)),
    sa.Column("rfc_message_id", sa.String(320)),
    sa.Column("error", sa.String(400)),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)

mail_files = sa.Table(
    "mail_files",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("draft_id", uuid_type),
    sa.Column("file_name", sa.String(240)),
    sa.Column("content_type", sa.String(160)),
    sa.Column("size_bytes", sa.Integer()),
    sa.Column("content_cipher", sa.LargeBinary()),
    sa.Column("signed_letter_id", uuid_type),
    sa.Column("signed_file_id", uuid_type),
    sa.Column("sha256", sa.String(64)),
)

mail_task_exports = sa.Table(
    "mail_task_exports",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("owner_user_id", uuid_type),
    sa.Column("fingerprint", sa.String(64)),
    sa.Column("source_cipher", sa.Text()),
    sa.Column("task_id", uuid_type),
)
