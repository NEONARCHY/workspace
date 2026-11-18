"""Track per-recipient results and bind mailing jobs to an approved PDF."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0124_referent_mailing"
down_revision = "0123_trip_hr_processing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_referent_letters", sa.Column(
        "is_mailing", sa.Boolean(), nullable=False, server_default=sa.false()
    ))
    op.create_table(
        "ai_referent_mailing_recipients",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("letter_id", UUID(), sa.ForeignKey("ai_referent_letters.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("organization", sa.String(500), nullable=False),
        sa.Column("address", sa.String(500), nullable=False),
        sa.Column("address_key", sa.String(500), nullable=False),
        sa.Column("directory_id", sa.String(128)),
        sa.Column("route", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("letter_id", "address_key", name="uq_referent_mailing_address"),
        sa.UniqueConstraint("letter_id", "position", name="uq_referent_mailing_position"),
        sa.CheckConstraint("route IN ('exat', 'webmail')", name="ck_referent_mailing_route"),
        sa.CheckConstraint(
            "status IN ('draft', 'queued', 'sending', 'sent', 'failed', 'unknown', 'stopped')",
            name="ck_referent_mailing_status",
        ),
    )
    for column in ("recipient_id", "requested_by", "approved_pdf_id"):
        op.add_column("ai_referent_delivery_commands", sa.Column(column, UUID()))
    op.create_foreign_key(
        "fk_referent_mailing_job_recipient", "ai_referent_delivery_commands",
        "ai_referent_mailing_recipients", ["recipient_id"], ["id"], ondelete="CASCADE",
    )
    op.create_index(
        "ix_referent_mailing_job_recipient", "ai_referent_delivery_commands", ["recipient_id"],
    )


def downgrade() -> None:
    # The previous API can send only a single address; never reinterpret a mailing as one.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM ai_referent_letters WHERE is_mailing) THEN
                RAISE EXCEPTION 'Archive official mailings before downgrading this schema';
            END IF;
        END $$
    """)
    op.drop_index("ix_referent_mailing_job_recipient", table_name="ai_referent_delivery_commands")
    op.drop_constraint(
        "fk_referent_mailing_job_recipient", "ai_referent_delivery_commands", type_="foreignkey",
    )
    for column in ("approved_pdf_id", "requested_by", "recipient_id"):
        op.drop_column("ai_referent_delivery_commands", column)
    op.drop_table("ai_referent_mailing_recipients")
    op.drop_column("ai_referent_letters", "is_mailing")
