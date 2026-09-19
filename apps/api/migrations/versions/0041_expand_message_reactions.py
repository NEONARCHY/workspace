"""Expand the allowed messenger reaction set.

Revision ID: 0041_expand_message_reactions
Revises: 0040_department_service_groups
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0041_expand_message_reactions"
down_revision: str | None = "0040_department_service_groups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REACTIONS = (
    "👍", "😄", "❤️", "🤝", "👏", "💔", "😔", "🔥", "👎", "🥳", "🤔", "🤯", "😱", "😡",
    "🎉", "🤩", "🤢", "💩", "🙏", "👌", "🐇", "🤡", "😭", "😌", "✅", "💯", "❗", "😂",
    "😮", "😢", "👀", "🥰", "😍", "😎", "💪", "🙌", "🚀", "😉", "😊", "🙂", "🙃", "😋",
    "😛", "😜", "🤪", "🧐", "🤓", "😇", "🤗", "🤭", "🤫", "🤥", "😐", "😑", "😶", "😏",
    "😒", "🙄", "😬", "🤐", "😪", "😴", "🤤", "😷", "🤒", "🤕", "🤑", "😈", "👿", "👻",
    "💀", "☠️", "👽", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾",
    "👋", "🤚", "🖐️", "✋", "🖖", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆",
    "👇", "☝️", "✍️", "💅", "🤳", "💃", "🕺", "🎊", "🎈", "💡", "⭐", "🌟", "⚡", "💥",
    "💦", "🎯", "🏆", "🥇", "📌", "📎", "🧠", "💬",
)


def _constraint(values: tuple[str, ...]) -> str:
    quoted = ", ".join("'" + value.replace("'", "''") + "'" for value in values)
    return f"emoji IN ({quoted})"


def upgrade() -> None:
    op.drop_constraint(
        "ck_messenger_message_reactions_emoji",
        "messenger_message_reactions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_messenger_message_reactions_emoji",
        "messenger_message_reactions",
        _constraint(REACTIONS),
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM messenger_message_reactions "
        "WHERE emoji NOT IN ('👍', '❤️', '👏', '🎉', '👀', '✅')"
    )
    op.drop_constraint(
        "ck_messenger_message_reactions_emoji",
        "messenger_message_reactions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_messenger_message_reactions_emoji",
        "messenger_message_reactions",
        _constraint(("👍", "❤️", "👏", "🎉", "👀", "✅")),
    )
