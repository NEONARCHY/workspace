"""A union of explicitly acknowledged entry IDs, safe across concurrent devices."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth import AuthenticatedUser
from .release_read_schemas import ReleaseReadInput, ReleaseReadState
from .tables import release_read_entries


async def load_reads(connection: AsyncConnection, user: AuthenticatedUser) -> ReleaseReadState:
    values = (await connection.execute(
        select(release_read_entries.c.entry_id)
        .where(release_read_entries.c.user_id == user.id)
        .order_by(release_read_entries.c.entry_id)
    )).scalars().all()
    return ReleaseReadState(read_entry_ids=list(values))


async def acknowledge_reads(
    connection: AsyncConnection, user: AuthenticatedUser, payload: ReleaseReadInput,
) -> ReleaseReadState:
    now = datetime.now(UTC)
    await connection.execute(insert(release_read_entries).values([
        {"user_id": user.id, "entry_id": entry_id, "acknowledged_at": now}
        for entry_id in payload.entry_ids
    ]).on_conflict_do_nothing(index_elements=[
        release_read_entries.c.user_id, release_read_entries.c.entry_id,
    ]))
    return await load_reads(connection, user)
