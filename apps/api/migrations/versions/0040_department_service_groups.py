"""Create synchronized service groups for existing departments.

Revision ID: 0040_department_service_groups
Revises: 0039_team_overview_access
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0040_department_service_groups"
down_revision: str | None = "0039_team_overview_access"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO messenger_chats (
            id, kind, direct_key, description, title, context_type, context_id,
            created_by_user_id, created_at, updated_at, deleted_at, deleted_by_user_id
        )
        SELECT gen_random_uuid(), 'group', NULL,
            'Служебная группа подразделения. Состав обновляется автоматически.',
            department.name, 'department', department.id, administrator.id,
            now(), now(), NULL, NULL
        FROM core_departments AS department
        CROSS JOIN LATERAL (
            SELECT id FROM core_users
            WHERE role IN ('superadmin', 'admin')
            ORDER BY CASE role WHEN 'superadmin' THEN 0 ELSE 1 END, created_at
            LIMIT 1
        ) AS administrator
        WHERE NOT EXISTS (
            SELECT 1 FROM messenger_chats AS chat
            WHERE chat.context_type = 'department'
              AND chat.context_id = department.id
              AND chat.deleted_at IS NULL
        )
    """)
    op.execute("""
        INSERT INTO messenger_chat_members (
            chat_id, user_id, member_role, permissions, joined_at, muted_until
        )
        SELECT chat.id, employee.id, 'member',
            '{"send_messages": true, "upload_files": true, "add_members": false,
              "remove_members": false, "manage_messages": false,
              "manage_chat": false}'::jsonb,
            now(), NULL
        FROM messenger_chats AS chat
        JOIN core_users AS employee ON employee.department_id = chat.context_id
        WHERE chat.context_type = 'department'
          AND chat.deleted_at IS NULL
          AND employee.status = 'active'
        ON CONFLICT (chat_id, user_id) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM messenger_chat_members
        WHERE chat_id IN (
            SELECT id FROM messenger_chats WHERE context_type = 'department'
        )
    """)
    op.execute("DELETE FROM messenger_chats WHERE context_type = 'department'")
