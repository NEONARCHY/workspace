"""Add position access rules for the standalone team overview.

Revision ID: 0039_team_overview_access
Revises: 0038_interface_locale
"""

# ruff: noqa: E501, RUF001 - official Uzbek position names retain their punctuation.

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039_team_overview_access"
down_revision: str | None = "0038_interface_locale"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_core_module_access_rules_subject_type",
        "core_module_access_rules",
        type_="check",
    )
    op.create_check_constraint(
        "ck_core_module_access_rules_subject_type",
        "core_module_access_rules",
        sa.column("subject_type").in_(("role", "department", "position", "user")),
    )
    op.execute("""
        INSERT INTO core_module_access_rules (
            id, subject_type, subject_key, module_key, permissions,
            created_by_user_id, created_at, updated_at
        )
        SELECT gen_random_uuid(), 'position', position.id::text, 'team_overview',
            '{"view": true, "create": false, "edit": false, "approve": false, "admin": false}'::jsonb,
            administrator.id, now(), now()
        FROM core_positions AS position
        CROSS JOIN LATERAL (
            SELECT id FROM core_users
            WHERE role IN ('superadmin', 'admin')
            ORDER BY CASE role WHEN 'superadmin' THEN 0 ELSE 1 END, created_at
            LIMIT 1
        ) AS administrator
        WHERE position.name IN (
            '"Yuksalish" harakati raisi, Qonunchilik palatasi qo''mita raisi',
            'Rais birinchi o‘rinbosari – ijrochi direktor',
            'Rais o‘rinbosari'
        )
        ON CONFLICT ON CONSTRAINT uq_core_module_access_rule_subject_module DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM core_module_access_rules
        WHERE subject_type = 'position' AND module_key = 'team_overview'
    """)
    op.drop_constraint(
        "ck_core_module_access_rules_subject_type",
        "core_module_access_rules",
        type_="check",
    )
    op.create_check_constraint(
        "ck_core_module_access_rules_subject_type",
        "core_module_access_rules",
        sa.column("subject_type").in_(("role", "department", "user")),
    )
