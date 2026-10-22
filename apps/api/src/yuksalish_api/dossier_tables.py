import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from .tables import metadata, uuid_type

dossiers = sa.Table(
    "hr_personnel_dossiers", metadata,
    sa.Column("user_id", uuid_type, primary_key=True),
    sa.Column("revision", sa.Integer()), sa.Column("status", sa.String(16)),
    sa.Column("data", postgresql.JSONB()),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
)
dossier_history = sa.Table(
    "hr_dossier_history", metadata,
    sa.Column("id", uuid_type, primary_key=True), sa.Column("user_id", uuid_type),
    sa.Column("revision", sa.Integer()), sa.Column("actor_user_id", uuid_type),
    sa.Column("changed_fields", postgresql.JSONB()),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)
dossier_access_settings = sa.Table(
    "hr_dossier_access_settings", metadata,
    sa.Column("id", sa.SmallInteger(), primary_key=True), sa.Column("revision", sa.Integer()),
)
dossier_access_rules = sa.Table(
    "hr_dossier_access_rules", metadata,
    sa.Column("id", uuid_type, primary_key=True), sa.Column("grantee_user_id", uuid_type),
    sa.Column("scope", sa.String(16)), sa.Column("scope_id", uuid_type),
    sa.Column("view", sa.Boolean()), sa.Column("edit", sa.Boolean()),
    sa.Column("photo_roster", sa.Boolean()),
)
