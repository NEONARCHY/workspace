import sqlalchemy as sa

from .tables import metadata, uuid_type

deliveries = sa.Table(
    "workspace_telegram_deliveries",
    metadata,
    sa.Column("id", uuid_type, primary_key=True),
    sa.Column("user_id", uuid_type),
    sa.Column("event_key", sa.String(320)),
    sa.Column("kind", sa.String(32)),
    sa.Column("entity_id", uuid_type),
    sa.Column("stage_key", sa.String(160)),
    sa.Column("entity_version", sa.Integer()),
    sa.Column("title", sa.String(240)),
    sa.Column("body", sa.Text()),
    sa.Column("state", sa.String(24)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
    sa.Column("retry_at", sa.DateTime(timezone=True)),
    sa.Column("attempts", sa.Integer()),
    sa.Column("lease_token", uuid_type),
    sa.Column("lease_until", sa.DateTime(timezone=True)),
    sa.Column("telegram_id", sa.String(20)),
    sa.Column("identity_revision", sa.Integer()),
    sa.Column("telegram_message_id", sa.BigInteger()),
    sa.Column("delivery_mode", sa.String(16)),
    sa.Column("finished_at", sa.DateTime(timezone=True)),
    sa.Column("last_error", sa.String(64)),
)
