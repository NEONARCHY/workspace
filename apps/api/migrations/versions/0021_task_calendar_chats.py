"""Backfill one automatically managed chat for every task.

Revision ID: 0021_task_calendar_chats
Revises: 0020_task_review_subtasks
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_task_calendar_chats"
down_revision: str | None = "0020_task_review_subtasks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_messenger_chat_context",
        "messenger_chats",
        ["context_type", "context_id"],
        unique=True,
        postgresql_where=sa.text("context_type IS NOT NULL AND context_id IS NOT NULL"),
    )
    op.execute("""
        INSERT INTO messenger_chats (
            id, kind, title, description, context_type, context_id, direct_key,
            created_by_user_id, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), 'task', 'Задача · ' || left(task.title, 231),
            left(task.description, 4000), 'task', task.id, NULL,
            task.author_user_id, task.created_at, task.updated_at
        FROM tasks AS task
        WHERE NOT EXISTS (
            SELECT 1 FROM messenger_chats AS chat
            WHERE chat.context_type = 'task' AND chat.context_id = task.id
        )
    """)
    op.execute("""
        INSERT INTO messenger_chat_members (
            chat_id, user_id, member_role, permissions, joined_at, muted_until
        )
        SELECT
            chat.id, task.author_user_id, 'owner',
            '{"send_messages": true, "upload_files": true, "invite_members": true,
              "manage_members": true, "edit_info": true, "manage_messages": true}'::jsonb,
            task.created_at, NULL
        FROM tasks AS task
        JOIN messenger_chats AS chat
          ON chat.context_type = 'task' AND chat.context_id = task.id
        ON CONFLICT (chat_id, user_id) DO UPDATE SET
            member_role = EXCLUDED.member_role,
            permissions = EXCLUDED.permissions
    """)
    op.execute("""
        INSERT INTO messenger_chat_members (
            chat_id, user_id, member_role, permissions, joined_at, muted_until
        )
        SELECT
            chat.id, member.user_id, 'member',
            '{"send_messages": true, "upload_files": true, "invite_members": false,
              "manage_members": false, "edit_info": false, "manage_messages": false}'::jsonb,
            task.created_at, NULL
        FROM tasks AS task
        JOIN messenger_chats AS chat
          ON chat.context_type = 'task' AND chat.context_id = task.id
        CROSS JOIN LATERAL (
            SELECT task.primary_assignee_user_id AS user_id
            UNION
            SELECT participant.user_id FROM tasks_participants AS participant
            WHERE participant.task_id = task.id
        ) AS member
        WHERE member.user_id <> task.author_user_id
        ON CONFLICT (chat_id, user_id) DO NOTHING
    """)


def downgrade() -> None:
    op.drop_index("uq_messenger_chat_context", table_name="messenger_chats")
