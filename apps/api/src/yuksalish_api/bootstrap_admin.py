import argparse
import asyncio
import getpass

from .auth_service import AuthServiceError, bootstrap_initial_admin
from .database import create_database_engine
from .settings import Settings


async def _run(username: str, full_name: str, password: str) -> None:
    settings = Settings()
    engine = create_database_engine(settings)
    try:
        async with engine.begin() as connection:
            user_id = await bootstrap_initial_admin(connection, username, full_name, password)
    finally:
        await engine.dispose()
    print(f"Initial administrator created: {username.strip().lower()} ({user_id})")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create the first Yuksalish Workspace administrator in an empty database."
    )
    parser.add_argument("--username", required=True)
    parser.add_argument("--full-name", required=True)
    arguments = parser.parse_args()
    password = getpass.getpass("New administrator password: ")
    confirmation = getpass.getpass("Repeat password: ")
    if password != confirmation:
        parser.error("Passwords do not match")
    try:
        asyncio.run(_run(arguments.username, arguments.full_name, password))
    except AuthServiceError as error:
        parser.error(error.detail)


if __name__ == "__main__":
    main()
