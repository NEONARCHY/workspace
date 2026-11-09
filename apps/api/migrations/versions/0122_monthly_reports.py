"""Monthly CA reporting and payroll authorization; no historical backfill."""

from alembic import op

revision = "0122_monthly_reports"
down_revision = "0121_ai_referent_rejection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE monthly_report_cycles (
            month date PRIMARY KEY CHECK (extract(day from month) = 1),
            reminder_on date NOT NULL,
            created_at timestamptz NOT NULL,
            authorized_at timestamptz,
            authorized_by uuid REFERENCES core_users(id),
            accountant_id uuid REFERENCES core_users(id),
            comment text NOT NULL DEFAULT '',
            authorization_snapshot json NOT NULL DEFAULT '{}',
            CHECK ((authorized_at IS NULL AND authorized_by IS NULL AND accountant_id IS NULL)
                OR (authorized_at IS NOT NULL AND authorized_by IS NOT NULL
                    AND accountant_id IS NOT NULL))
        )
    """)
    op.execute("""
        CREATE TABLE monthly_report_members (
            month date NOT NULL REFERENCES monthly_report_cycles(month),
            user_id uuid NOT NULL REFERENCES core_users(id),
            name varchar(200) NOT NULL,
            department varchar(200) NOT NULL,
            PRIMARY KEY (month, user_id)
        )
    """)
    op.execute("""
        CREATE TABLE monthly_reports (
            id uuid PRIMARY KEY,
            month date NOT NULL,
            user_id uuid NOT NULL,
            revision integer NOT NULL CHECK (revision > 0),
            comment text NOT NULL,
            digest varchar(64) NOT NULL,
            files json NOT NULL,
            submitted_at timestamptz NOT NULL,
            FOREIGN KEY (month, user_id) REFERENCES monthly_report_members(month, user_id),
            UNIQUE (month, user_id, revision)
        )
    """)
    op.execute("""
        CREATE TABLE monthly_report_calendar (
            day date PRIMARY KEY,
            working boolean NOT NULL,
            note varchar(300) NOT NULL,
            updated_by uuid NOT NULL REFERENCES core_users(id),
            updated_at timestamptz NOT NULL
        )
    """)
    op.drop_constraint(
        "ck_workspace_notifications_section", "workspace_notifications", type_="check"
    )
    op.create_check_constraint(
        "ck_workspace_notifications_section",
        "workspace_notifications",
        "section IN ('messenger','tasks','payment_requests','trip_approvals',"
        "'leave_approvals','calendar','absences','zoom_meetings','hr','team_overview',"
        "'ai_referent','project_hub','project_funding','ai_hisobot','notifications',"
        "'feed','grants','home','ai_monthly_reports')",
    )


def downgrade() -> None:
    raise RuntimeError(
        "Preserve monthly reports and payroll decisions; destructive rollback refused"
    )
