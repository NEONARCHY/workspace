"""One-time, explicitly confirmed cleanup of the demo workspace.

This command is intentionally not an Alembic migration: it removes tenant data and must only
be run by an operator after taking a database backup.  It keeps one employee identity while
transferring the current administrator credentials to it, then removes every user-linked row
and every object from the configured workspace bucket.
"""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from minio import Minio
from minio.deleteobjects import DeleteObject
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from yuksalish_api.settings import Settings, get_settings

CONFIRMATION = "PURGE-DEMO-WORKSPACE"


@dataclass(frozen=True)
class WorkspaceUser:
    id: UUID
    username: str
    full_name: str
    role: str


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


async def _load_users(engine: AsyncEngine) -> list[WorkspaceUser]:
    async with engine.connect() as connection:
        result = await connection.execute(
            text(
                "SELECT id, username, full_name, role "
                "FROM core_users ORDER BY created_at, id"
            )
        )
        return [WorkspaceUser(**row._mapping) for row in result]


async def _referencing_tables(engine: AsyncEngine) -> list[tuple[str, str]]:
    query = text(
        """
        SELECT DISTINCT namespace.nspname AS schema_name, relation.relname AS table_name
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE constraint_row.contype = 'f'
          AND constraint_row.confrelid = 'public.core_users'::regclass
          AND constraint_row.conrelid <> 'public.core_users'::regclass
        ORDER BY namespace.nspname, relation.relname
        """
    )
    async with engine.connect() as connection:
        result = await connection.execute(query)
        return [(row.schema_name, row.table_name) for row in result]


def _find_user(users: Sequence[WorkspaceUser], user_id: UUID, label: str) -> WorkspaceUser:
    user = next((candidate for candidate in users if candidate.id == user_id), None)
    if user is None:
        raise RuntimeError(f"{label} {user_id} does not exist")
    return user


async def purge_database(
    engine: AsyncEngine,
    *,
    keeper_user_id: UUID,
    credential_source_user_id: UUID,
) -> tuple[WorkspaceUser, WorkspaceUser, int]:
    users = await _load_users(engine)
    keeper = _find_user(users, keeper_user_id, "Keeper user")
    credential_source = _find_user(users, credential_source_user_id, "Credential source user")
    if keeper.id == credential_source.id:
        raise RuntimeError("Keeper and credential source must be different users")

    tables = await _referencing_tables(engine)
    if not tables:
        raise RuntimeError("No user-linked tables were found; refusing an unexpected schema")

    qualified_tables = ", ".join(
        f"{_quote_identifier(schema)}.{_quote_identifier(table_name)}"
        for schema, table_name in tables
    )
    retired_username = f"purged-{credential_source.id}"

    async with engine.begin() as connection:
        await connection.execute(text("LOCK TABLE core_users IN ACCESS EXCLUSIVE MODE"))
        await connection.execute(
            text(
                "UPDATE core_users SET username = :retired_username, role = 'admin' "
                "WHERE id = :source_user_id"
            ),
            {
                "retired_username": retired_username,
                "source_user_id": credential_source.id,
            },
        )
        await connection.execute(
            text(
                """
                UPDATE core_users AS keeper
                SET username = :active_username,
                    password_hash = source.password_hash,
                    password_changed_at = source.password_changed_at,
                    role = 'superadmin',
                    status = 'active',
                    failed_login_count = 0,
                    locked_until = NULL,
                    updated_at = now()
                FROM core_users AS source
                WHERE keeper.id = :keeper_user_id
                  AND source.id = :source_user_id
                """
            ),
            {
                "keeper_user_id": keeper.id,
                "source_user_id": credential_source.id,
                "active_username": credential_source.username,
            },
        )
        await connection.execute(text(f"TRUNCATE TABLE {qualified_tables} CASCADE"))
        await connection.execute(
            text("DELETE FROM core_users WHERE id <> :keeper_user_id"),
            {"keeper_user_id": keeper.id},
        )

        remaining = await connection.scalar(text("SELECT count(*) FROM core_users"))
        if remaining != 1:
            raise RuntimeError(f"Expected one remaining user, found {remaining}")

    return keeper, credential_source, len(tables)


def purge_object_storage(settings: Settings) -> int:
    client = Minio(
        settings.s3_endpoint,
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key.get_secret_value(),
        secure=settings.s3_secure,
    )
    if not client.bucket_exists(settings.s3_bucket):
        return 0

    object_names = [
        item.object_name
        for item in client.list_objects(settings.s3_bucket, recursive=True)
    ]
    if not object_names:
        return 0

    errors = list(
        client.remove_objects(
            settings.s3_bucket,
            (DeleteObject(object_name) for object_name in object_names),
        )
    )
    if errors:
        raise RuntimeError(f"Object storage cleanup failed for {len(errors)} object(s)")
    return len(object_names)


async def purge_runtime_cache(settings: Settings) -> None:
    cache = Redis.from_url(settings.redis_url)
    try:
        await cache.flushdb()
    finally:
        await cache.aclose()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keeper-user-id", required=True, type=UUID)
    parser.add_argument("--credential-source-user-id", required=True, type=UUID)
    parser.add_argument(
        "--confirm",
        help=f"Execute the destructive cleanup only when set to {CONFIRMATION!r}",
    )
    return parser


async def _run(arguments: argparse.Namespace) -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    try:
        users = await _load_users(engine)
        keeper = _find_user(users, arguments.keeper_user_id, "Keeper user")
        source = _find_user(users, arguments.credential_source_user_id, "Credential source user")
        tables = await _referencing_tables(engine)

        print(f"Users currently present: {len(users)}")
        print(f"Keep identity: {keeper.full_name} ({keeper.username}, {keeper.id})")
        print(f"Transfer credentials from: {source.full_name} ({source.username}, {source.id})")
        print(f"Users to remove: {len(users) - 1}")
        print(f"Direct user-linked tables to clear: {len(tables)}")

        if arguments.confirm != CONFIRMATION:
            print("Dry run only. Take a backup, then pass the exact --confirm value to execute.")
            return

        keeper, source, table_count = await purge_database(
            engine,
            keeper_user_id=arguments.keeper_user_id,
            credential_source_user_id=arguments.credential_source_user_id,
        )
        deleted_objects = await asyncio.to_thread(purge_object_storage, settings)
        await purge_runtime_cache(settings)
        print(
            f"Cleanup complete: kept {keeper.full_name}, transferred login {source.username}, "
            f"cleared {table_count} linked tables, {deleted_objects} stored object(s), and the "
            "runtime cache."
        )
    finally:
        await engine.dispose()


def main() -> None:
    asyncio.run(_run(_parser().parse_args()))


if __name__ == "__main__":
    main()
