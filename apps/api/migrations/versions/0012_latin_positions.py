"""Normalize position titles and bind payment actors by position.

Revision ID: 0012_latin_positions
Revises: 0011_payment_workflows
"""

from collections.abc import Sequence

# ruff: noqa: RUF001 - migration matches legacy mixed-script source values exactly.
import sqlalchemy as sa
from alembic import op

revision: str = "0012_latin_positions"
down_revision: str | None = "0011_payment_workflows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


POSITION_NORMALIZATIONS = (
    ("Инсон капитали бўйича бўлим", "Inson kapitali bo‘yicha bo‘lim"),
    (
        "Xalqaro hamkorlikni rivojlantirish bo‘limи boshlig‘i",
        "Xalqaro hamkorlikni rivojlantirish bo‘limi boshlig‘i",
    ),
    ("Финансовый менеджер", "Moliyaviy menejer"),
    ("Руководитель отдела", "Bo‘lim boshlig‘i"),
    ("Специалист по закупкам", "Xaridlar bo‘yicha mutaxassis"),
    ("Директор", "Direktor"),
)


def upgrade() -> None:
    connection = op.get_bind()
    for old_name, new_name in POSITION_NORMALIZATIONS:
        connection.execute(
            sa.text(
                "UPDATE core_positions SET name = :new_name, updated_at = now() "
                "WHERE name = :old_name"
            ),
            {"old_name": old_name, "new_name": new_name},
        )
    connection.execute(
        sa.text(
            "UPDATE core_users AS u SET job_title = p.name, updated_at = now() "
            "FROM core_positions AS p WHERE p.id = u.position_id"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE core_users SET job_title = 'Tizim administratori', updated_at = now() "
            "WHERE job_title = 'Системный администратор'"
        )
    )
    op.create_check_constraint(
        "ck_core_positions_name_latin",
        "core_positions",
        "name !~ '[Ѐ-ԯ]'",
    )
    op.create_check_constraint(
        "ck_core_users_job_title_latin",
        "core_users",
        "job_title IS NULL OR job_title !~ '[Ѐ-ԯ]'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_core_users_job_title_latin", "core_users", type_="check")
    op.drop_constraint("ck_core_positions_name_latin", "core_positions", type_="check")
    connection = op.get_bind()
    for old_name, new_name in reversed(POSITION_NORMALIZATIONS):
        connection.execute(
            sa.text(
                "UPDATE core_positions SET name = :old_name, updated_at = now() "
                "WHERE name = :new_name"
            ),
            {"old_name": old_name, "new_name": new_name},
        )
    connection.execute(
        sa.text(
            "UPDATE core_users AS u SET job_title = p.name, updated_at = now() "
            "FROM core_positions AS p WHERE p.id = u.position_id"
        )
    )
