"""Queue newly created Workspace notices for explicitly granted Telegram users."""

import sqlalchemy as sa
from alembic import op

revision = "0127_notification_mirror"
down_revision = "0126_session_admin_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_workspace_telegram_kind", "workspace_telegram_deliveries", type_="check")
    op.create_check_constraint(
        "ck_workspace_telegram_kind", "workspace_telegram_deliveries",
        "kind IN ('task_assigned','payment_action','workspace_notice')",
    )
    op.create_index(
        "ix_workspace_telegram_entity_dedupe", "workspace_telegram_deliveries",
        ["user_id", "entity_id", "kind", "created_at"],
    )
    op.execute("""
        CREATE FUNCTION queue_workspace_telegram_notice() RETURNS trigger AS $$
        BEGIN
          IF NEW.section = 'ai_hisobot' OR NEW.dismissed_at IS NOT NULL THEN
            RETURN NEW;
          END IF;
          INSERT INTO workspace_telegram_deliveries
            (id, user_id, event_key, kind, entity_id, stage_key, title, body,
             state, created_at, attempts)
          SELECT gen_random_uuid(), NEW.user_id, 'notice:' || NEW.id::text,
                 'workspace_notice', NEW.id, NEW.section, NEW.title, NEW.body,
                 'pending', now(), 0
          WHERE EXISTS (
            SELECT 1 FROM core_users u
            JOIN telegram_identities i ON i.user_id = u.id
            JOIN telegram_bot_grants g ON g.user_id = u.id
            WHERE u.id = NEW.user_id AND u.status = 'active'
              AND i.telegram_id IS NOT NULL AND i.verified_at IS NOT NULL
              AND g.bot_key = 'workspace_notifications'
          )
          AND NOT (
            NEW.section = 'tasks' AND EXISTS (
              SELECT 1 FROM workspace_telegram_deliveries d
              WHERE d.user_id = NEW.user_id AND d.entity_id = NEW.entity_id
                AND d.kind = 'task_assigned'
                AND d.created_at >= now() - interval '5 minutes'
            )
          )
          AND NOT (
            NEW.section = 'payment_requests' AND EXISTS (
              SELECT 1 FROM workspace_telegram_deliveries d
              WHERE d.user_id = NEW.user_id AND d.entity_id = NEW.entity_id
                AND d.kind = 'payment_action'
                AND d.created_at >= now() - interval '5 minutes'
            )
          )
          ON CONFLICT (user_id, event_key) DO NOTHING;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_queue_workspace_telegram_notice
          AFTER INSERT ON workspace_notifications
          FOR EACH ROW EXECUTE FUNCTION queue_workspace_telegram_notice()
    """)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_queue_workspace_telegram_notice ON workspace_notifications"
    )
    op.execute("DROP FUNCTION IF EXISTS queue_workspace_telegram_notice()")
    count = op.get_bind().scalar(sa.text(
        "SELECT count(*) FROM workspace_telegram_deliveries WHERE kind = 'workspace_notice'"
    ))
    if count:
        raise RuntimeError("Preserve Workspace notification delivery receipts")
    op.drop_index("ix_workspace_telegram_entity_dedupe", table_name="workspace_telegram_deliveries")
    op.drop_constraint("ck_workspace_telegram_kind", "workspace_telegram_deliveries", type_="check")
    op.create_check_constraint(
        "ck_workspace_telegram_kind", "workspace_telegram_deliveries",
        "kind IN ('task_assigned','payment_action')",
    )
