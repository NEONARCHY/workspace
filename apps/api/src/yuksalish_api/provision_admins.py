"""One-time, interactive provisioning of the owner and an ordinary administrator.

Passwords are read from the terminal without echo and never accepted as CLI args or env vars.
The operation does not replace or demote existing accounts silently.
"""

import argparse
import asyncio
import getpass
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from .auth_service import AuthServiceError, hash_password, validate_password
from .database import create_database_engine
from .settings import Settings
from .tables import users


def _password(label: str, username: str) -> str:
    password = getpass.getpass(f"{label} password: ")
    confirmation = getpass.getpass(f"Repeat {label} password: ")
    if password != confirmation:
        raise AuthServiceError(422, "Passwords do not match")
    validate_password(password, username)
    return password


async def create_named_administrators(
    connection: AsyncConnection,
    *,
    superadmin_username: str,
    superadmin_name: str,
    superadmin_password: str,
    admin_username: str,
    admin_name: str,
    admin_password: str,
) -> None:
    owner = superadmin_username.strip().lower()
    administrator = admin_username.strip().lower()
    if owner == administrator:
        raise AuthServiceError(422, "Administrator usernames must be distinct")
    for username, name, password in (
        (owner, superadmin_name, superadmin_password),
        (administrator, admin_name, admin_password),
    ):
        if not 3 <= len(username) <= 64 or any(
            char not in "abcdefghijklmnopqrstuvwxyz0123456789._-" for char in username
        ):
            raise AuthServiceError(422, "Invalid administrator username")
        if not 2 <= len(name.strip()) <= 200:
            raise AuthServiceError(422, "Invalid administrator name")
        validate_password(password, username)
    existing = (
        await connection.execute(
            select(users.c.username, users.c.role).where(
                (users.c.role == "superadmin") | users.c.username.in_([owner, administrator])
            )
        )
    ).mappings().all()
    if existing:
        # No implicit password resets, role changes or takeover of an existing owner.
        raise AuthServiceError(409, "Administrator accounts already exist; inspect them first")
    now = datetime.now(UTC)
    for username, name, password, role in (
        (owner, superadmin_name, superadmin_password, "superadmin"),
        (administrator, admin_name, admin_password, "admin"),
    ):
        await connection.execute(
            insert(users).values(
                id=uuid4(), username=username, full_name=name.strip(),
                job_title="Tizim administratori", password_hash=hash_password(password),
                role=role, status="active", department_id=None, created_at=now,
                updated_at=now, failed_login_count=0, locked_until=None,
                password_changed_at=now,
            )
        )


async def _run(arguments: argparse.Namespace, owner_password: str, admin_password: str) -> None:
    engine = create_database_engine(Settings())
    try:
        async with engine.begin() as connection:
            await create_named_administrators(
                connection,
                superadmin_username=arguments.superadmin_username,
                superadmin_name=arguments.superadmin_name,
                superadmin_password=owner_password,
                admin_username=arguments.admin_username,
                admin_name=arguments.admin_name,
                admin_password=admin_password,
            )
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create exactly one superadmin and one admin")
    parser.add_argument("--superadmin-username", required=True)
    parser.add_argument("--superadmin-name", required=True)
    parser.add_argument("--admin-username", required=True)
    parser.add_argument("--admin-name", required=True)
    arguments = parser.parse_args()
    try:
        owner_password = _password("Superadmin", arguments.superadmin_username)
        admin_password = _password("Admin", arguments.admin_username)
        asyncio.run(_run(arguments, owner_password, admin_password))
    except AuthServiceError as error:
        parser.error(error.detail)
    print("Administrator accounts created. Enable TOTP at first login.")


if __name__ == "__main__":
    main()
