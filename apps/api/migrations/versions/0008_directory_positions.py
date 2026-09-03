"""Add editable positions and auditable directory administration.

Revision ID: 0008_directory_positions
Revises: 0007_password_recovery
"""

# The source labels intentionally preserve the exact Unicode punctuation used in Bitrix.
# ruff: noqa: RUF001

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_directory_positions"
down_revision: str | None = "0007_password_recovery"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


BITRIX_POSITION_NAMES = (
    '"Yuksalish" harakati raisi, Qonunchilik palatasi qo\'mita raisi',
    "Rais birinchi o‘rinbosari – ijrochi direktor",
    "Rais o‘rinbosari",
    "Sun’iy intellekt va raqamlashtirish bo‘limi yetakchi mutaxassisi",
    "Raqamlashtirish va sun'iy intellekt bo'limi boshlig'i",
    "Moliyachi",
    "Matbuot kotibi",
    "Kanselyariya bosh mutaxassisi",
    "Islohotlarni qoʼllab-quvvatlash va jamoatchilik nazoratini rivojlantirish boʼlimi",
    "Xalqaro hamkorlikni rivojlantirish bo‘limi bosh mutaxassisi",
    "Islohotlarni qo‘llab-quvvatlash va umumlashtirish bo‘limi bosh mutaxassisi",
    "Harakat a’zolari bilan ishlash va tadbirkorlar bilan muloqot bo‘limi boshlig‘i",
    "Fuqarolik jamiyati institutlari bilan hamkorlik bo'limi boshlig'i",
    "Fuqarolik jamiyati institutlari bilan aloqalar bo‘limi bosh mutaxassisi",
    "Dizayner",
    "Bosh hisobchi",
    "Auditor",
    "Инсон капитали бўйича бўлим",
    "Hududiy bo‘linmalar bilan ishlash bo‘limi boshlig‘i",
    "Xalqaro hamkorlikni rivojlantirish bo‘limи boshlig‘i",
)


def _position_id(name: str):
    return uuid5(NAMESPACE_URL, f"https://workspace.yuksalish.uz/position/{name}")


def upgrade() -> None:
    op.create_table(
        "core_positions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="workspace"),
        sa.Column(
            "aliases",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", name="uq_core_positions_name"),
    )
    op.create_index(
        "ix_core_positions_active_sort",
        "core_positions",
        ["is_active", "sort_order", "name"],
    )
    op.add_column(
        "core_users",
        sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_core_users_position_id",
        "core_users",
        "core_positions",
        ["position_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_core_users_position_id", "core_users", ["position_id"])
    op.create_table(
        "core_audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=96), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "details",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_core_audit_events_target_created",
        "core_audit_events",
        ["target_type", "target_id", "created_at"],
    )

    connection = op.get_bind()
    now = datetime.now(UTC).replace(microsecond=0)
    existing_titles = connection.execute(
        sa.text(
            "SELECT DISTINCT job_title FROM core_users "
            "WHERE job_title IS NOT NULL AND btrim(job_title) <> ''"
        )
    ).scalars()
    names = list(BITRIX_POSITION_NAMES)
    for title in existing_titles:
        if title not in names:
            names.append(title)
    position_table = sa.table(
        "core_positions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("sort_order", sa.Integer()),
        sa.column("source", sa.String()),
        sa.column("aliases", postgresql.JSONB()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        position_table,
        [
            {
                "id": _position_id(name),
                "name": name,
                "is_active": True,
                "sort_order": index * 10,
                "source": "bitrix" if name in BITRIX_POSITION_NAMES else "workspace",
                "aliases": [],
                "created_at": now,
                "updated_at": now,
            }
            for index, name in enumerate(names, start=1)
        ],
    )
    connection.execute(
        sa.text(
            "UPDATE core_users AS u SET position_id = p.id "
            "FROM core_positions AS p WHERE p.name = u.job_title"
        )
    )


def downgrade() -> None:
    op.drop_index("ix_core_audit_events_target_created", table_name="core_audit_events")
    op.drop_table("core_audit_events")
    op.drop_index("ix_core_users_position_id", table_name="core_users")
    op.drop_constraint("fk_core_users_position_id", "core_users", type_="foreignkey")
    op.drop_column("core_users", "position_id")
    op.drop_index("ix_core_positions_active_sort", table_name="core_positions")
    op.drop_table("core_positions")
