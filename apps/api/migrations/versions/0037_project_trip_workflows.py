"""Add independent workflow templates for projects and trips.

Revision ID: 0037_project_trip_workflows
Revises: 0036_project_trip_chats
"""

# ruff: noqa: E501, RUF001

from collections.abc import Sequence

from alembic import op

revision: str = "0037_project_trip_workflows"
down_revision: str | None = "0036_project_trip_chats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        WITH owner AS (
            SELECT id FROM core_users
            WHERE role IN ('superadmin', 'admin')
            ORDER BY CASE role WHEN 'superadmin' THEN 0 ELSE 1 END, created_at
            LIMIT 1
        ), templates(template_key, name, version, status) AS (
            VALUES
                ('project', 'Маршрут проектов', 1, 'published'),
                ('project', 'Маршрут проектов', 2, 'draft'),
                ('trip', 'Маршрут поездок', 1, 'published'),
                ('trip', 'Маршрут поездок', 2, 'draft')
        )
        INSERT INTO approval_templates (
            id, template_key, name, request_kind, version, status, form_schema,
            created_by_user_id, created_at, published_at
        )
        SELECT gen_random_uuid(), template_key, name, 'generic', version, status,
            jsonb_build_object('process', template_key), owner.id, now(),
            CASE WHEN status = 'published' THEN now() ELSE NULL END
        FROM templates CROSS JOIN owner
        ON CONFLICT (template_key, version) DO NOTHING
    """)
    op.execute("""
        WITH nodes(template_key, node_key, kind, title, detail, x) AS (
            VALUES
                ('project', 'start', 'start', 'Начало', 'Регистрация нового проекта', 0),
                ('project', 'preparation', 'approval', 'Подготовка', 'Подготовка плана и команды', 260),
                ('project', 'approval', 'approval', 'Согласование', 'Решение по запуску проекта', 520),
                ('project', 'success', 'end', 'Успех', 'Проект успешно завершён', 780),
                ('project', 'failure', 'end', 'Провал', 'Проект остановлен с причиной', 1040),
                ('trip', 'launch', 'start', 'Запуск', 'Создание и отправка поездки', 0),
                ('trip', 'manager_approval', 'approval', 'Утверждение руководителем', 'Решение руководителя', 260),
                ('trip', 'hr', 'approval', 'Кадровая служба', 'Проверка кадровой службой', 520),
                ('trip', 'approved', 'end', 'Утверждено', 'Поездка согласована', 780),
                ('trip', 'rejected', 'end', 'Отклонено', 'Поездка отклонена с причиной', 1040)
        )
        INSERT INTO approval_nodes (
            id, template_id, node_key, kind, title, config, position_x, position_y
        )
        SELECT gen_random_uuid(), template.id, node.node_key, node.kind, node.title,
            jsonb_build_object('detail', node.detail), node.x, 120
        FROM nodes AS node
        JOIN approval_templates AS template ON template.template_key = node.template_key
        ON CONFLICT (template_id, node_key) DO NOTHING
    """)
    op.execute("""
        WITH edges(template_key, source_key, target_key, outcome, sort_order) AS (
            VALUES
                ('project', 'start', 'preparation', 'approve', 0),
                ('project', 'preparation', 'approval', 'approve', 0),
                ('project', 'approval', 'success', 'approve', 0),
                ('project', 'approval', 'failure', 'reject', 1),
                ('trip', 'launch', 'manager_approval', 'submit', 0),
                ('trip', 'manager_approval', 'hr', 'approve', 0),
                ('trip', 'manager_approval', 'launch', 'return', 1),
                ('trip', 'manager_approval', 'rejected', 'reject', 2),
                ('trip', 'hr', 'approved', 'approve', 0),
                ('trip', 'hr', 'launch', 'return', 1),
                ('trip', 'hr', 'rejected', 'reject', 2)
        )
        INSERT INTO approval_edges (
            id, template_id, source_node_key, target_node_key, outcome, label,
            condition, sort_order
        )
        SELECT gen_random_uuid(), template.id, edge.source_key, edge.target_key,
            edge.outcome, NULL, '{}'::jsonb, edge.sort_order
        FROM edges AS edge
        JOIN approval_templates AS template ON template.template_key = edge.template_key
        ON CONFLICT (template_id, source_node_key, outcome, sort_order) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM approval_templates WHERE template_key IN ('project', 'trip')")
