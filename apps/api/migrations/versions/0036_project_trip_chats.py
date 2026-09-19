"""Create managed chats for projects and trip requests.

Revision ID: 0036_project_trip_chats
Revises: 0035_desktop_release_notes
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0036_project_trip_chats"
down_revision: str | None = "0035_desktop_release_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FULL = """'{"send_messages": true, "upload_files": true, "invite_members": true,
  "manage_members": true, "edit_info": true, "manage_messages": true}'::jsonb"""
MEMBER = """'{"send_messages": true, "upload_files": true, "invite_members": false,
  "manage_members": false, "edit_info": false, "manage_messages": false}'::jsonb"""


def upgrade() -> None:
    op.execute("""
        INSERT INTO messenger_chats (
            id, kind, title, description, context_type, context_id, direct_key,
            created_by_user_id, created_at, updated_at
        )
        SELECT gen_random_uuid(), 'project', 'Проект · ' || left(project.title, 231),
            left(project.description, 4000), 'project', project.id, NULL,
            project.created_by_user_id, project.created_at, project.updated_at
        FROM workspace_projects AS project
        WHERE NOT EXISTS (SELECT 1 FROM messenger_chats AS chat
            WHERE chat.context_type = 'project' AND chat.context_id = project.id)
    """)
    op.execute(f"""
        INSERT INTO messenger_chat_members
            (chat_id, user_id, member_role, permissions, joined_at, muted_until)
        SELECT chat.id, project.created_by_user_id, 'owner', {FULL}, project.created_at, NULL
        FROM workspace_projects AS project JOIN messenger_chats AS chat
          ON chat.context_type = 'project' AND chat.context_id = project.id
        ON CONFLICT (chat_id, user_id) DO UPDATE SET
          member_role = EXCLUDED.member_role, permissions = EXCLUDED.permissions
    """)
    op.execute(f"""
        INSERT INTO messenger_chat_members
            (chat_id, user_id, member_role, permissions, joined_at, muted_until)
        SELECT chat.id, project.manager_user_id, 'member', {MEMBER}, project.created_at, NULL
        FROM workspace_projects AS project JOIN messenger_chats AS chat
          ON chat.context_type = 'project' AND chat.context_id = project.id
        WHERE project.manager_user_id <> project.created_by_user_id
        ON CONFLICT (chat_id, user_id) DO NOTHING
    """)
    op.execute("""
        INSERT INTO messenger_chats (
            id, kind, title, description, context_type, context_id, direct_key,
            created_by_user_id, created_at, updated_at
        )
        SELECT gen_random_uuid(), 'approval',
            'Поездка · ' || left(trip.destination || ' · ' || trip.purpose, 230),
            left(trip.purpose, 4000), 'trip', trip.id, NULL,
            trip.requester_user_id, trip.created_at, trip.updated_at
        FROM trip_requests AS trip
        WHERE NOT EXISTS (SELECT 1 FROM messenger_chats AS chat
            WHERE chat.context_type = 'trip' AND chat.context_id = trip.id)
    """)
    op.execute(f"""
        INSERT INTO messenger_chat_members
            (chat_id, user_id, member_role, permissions, joined_at, muted_until)
        SELECT chat.id, trip.requester_user_id, 'owner', {FULL}, trip.created_at, NULL
        FROM trip_requests AS trip JOIN messenger_chats AS chat
          ON chat.context_type = 'trip' AND chat.context_id = trip.id
        ON CONFLICT (chat_id, user_id) DO UPDATE SET
          member_role = EXCLUDED.member_role, permissions = EXCLUDED.permissions
    """)
    op.execute(f"""
        INSERT INTO messenger_chat_members
            (chat_id, user_id, member_role, permissions, joined_at, muted_until)
        SELECT chat.id, employee.user_id, 'member', {MEMBER}, trip.created_at, NULL
        FROM trip_requests AS trip
        JOIN messenger_chats AS chat ON chat.context_type = 'trip' AND chat.context_id = trip.id
        JOIN trip_request_employees AS employee ON employee.request_id = trip.id
        WHERE employee.user_id <> trip.requester_user_id
        ON CONFLICT (chat_id, user_id) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""DELETE FROM messenger_chat_members WHERE chat_id IN (
        SELECT id FROM messenger_chats WHERE context_type IN ('project', 'trip')
    )""")
    op.execute("DELETE FROM messenger_chats WHERE context_type IN ('project', 'trip')")
