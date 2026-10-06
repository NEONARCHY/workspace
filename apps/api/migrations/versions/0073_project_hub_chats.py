"""Add managed conversations for existing projects without moving legacy records."""

from collections.abc import Sequence

from alembic import op

revision: str = "0073_project_hub_chats"
down_revision: str = "0072_chat_avatar_icons"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO messenger_chats (
            id, kind, title, description, context_type, context_id,
            created_by_user_id, created_at, updated_at
        )
        SELECT gen_random_uuid(), 'project', left('Проект · ' || project.title, 240),
            left(project.description, 4000), 'project_hub', project.id,
            project.created_by_user_id, project.created_at, project.updated_at
        FROM project_hub_projects AS project
        ON CONFLICT (context_type, context_id)
            WHERE context_type IS NOT NULL AND context_id IS NOT NULL DO NOTHING
    """)
    op.execute("""
        WITH participants AS (
            SELECT id AS project_id, created_by_user_id AS user_id FROM project_hub_projects
            UNION SELECT id, manager_user_id FROM project_hub_projects
            UNION SELECT project_id, user_id FROM project_hub_people
            UNION SELECT item.project_id, assignee.user_id
                FROM project_hub_items AS item JOIN project_hub_item_assignees AS assignee
                ON assignee.item_id = item.id
        )
        INSERT INTO messenger_chat_members
            (chat_id, user_id, member_role, permissions, joined_at, muted_until)
        SELECT chat.id, participant.user_id,
            CASE WHEN participant.user_id = project.created_by_user_id
                THEN 'owner' ELSE 'member' END,
            jsonb_build_object('send_messages', true, 'upload_files', true,
                'invite_members', participant.user_id = project.created_by_user_id,
                'manage_members', participant.user_id = project.created_by_user_id,
                'edit_info', participant.user_id = project.created_by_user_id,
                'manage_messages', participant.user_id = project.created_by_user_id),
            project.created_at, NULL
        FROM participants AS participant
        JOIN project_hub_projects AS project ON project.id = participant.project_id
        JOIN messenger_chats AS chat ON chat.context_type = 'project_hub'
            AND chat.context_id = participant.project_id
        ON CONFLICT (chat_id, user_id) DO NOTHING
    """)


def downgrade() -> None:
    # Preserve conversations and their history when rolling back application code.
    pass
