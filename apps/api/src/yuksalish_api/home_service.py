"""Personal, permission-bound aggregates; never exposes another employee's content."""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action, module_permissions_for_user
from .auth import AuthenticatedUser
from .tables import chat_members, chats, message_reactions, messages
from .workspace_schemas import ApiModel


class PersonalReactionCount(ApiModel):
    emoji: str
    count: int


class PersonalReactionSummary(ApiModel):
    total_count: int
    reactions: list[PersonalReactionCount]


async def personal_reactions(
    connection: AsyncConnection, user: AuthenticatedUser
) -> PersonalReactionSummary:
    await ensure_module_action(connection, user, "home", "view")
    permissions = await module_permissions_for_user(connection, user)
    if not permissions["messenger"]["view"]:
        return PersonalReactionSummary(total_count=0, reactions=[])
    # Membership and history boundaries also apply to aggregates, including admins.
    rows = (
        (
            await connection.execute(
                select(message_reactions.c.emoji, func.count().label("count"))
                .select_from(
                    message_reactions.join(
                        messages, messages.c.id == message_reactions.c.message_id
                    )
                    .join(chats, chats.c.id == messages.c.chat_id)
                    .join(chat_members, chat_members.c.chat_id == messages.c.chat_id)
                )
                .where(
                    messages.c.author_user_id == user.id,
                    message_reactions.c.user_id != user.id,
                    messages.c.deleted_at.is_(None),
                    chats.c.deleted_at.is_(None),
                    chat_members.c.user_id == user.id,
                    or_(
                        chat_members.c.history_visible_from.is_(None),
                        messages.c.created_at >= chat_members.c.history_visible_from,
                    ),
                )
                .group_by(message_reactions.c.emoji)
                .order_by(func.count().desc(), message_reactions.c.emoji)
            )
        )
        .mappings()
        .all()
    )
    reactions = [PersonalReactionCount(emoji=row["emoji"], count=row["count"]) for row in rows]
    return PersonalReactionSummary(
        total_count=sum(item.count for item in reactions), reactions=reactions
    )
