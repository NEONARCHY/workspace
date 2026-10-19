"""Print only schema revision and aggregate counts; never output business records."""

import asyncio
import json

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from yuksalish_api.settings import Settings
from yuksalish_api.tables import messages, tasks, users


async def main() -> None:
    engine = create_async_engine(Settings().database_url)
    try:
        async with engine.connect() as connection:
            result = {
                "schema": await connection.scalar(text("SELECT version_num FROM alembic_version"))
            }
            for name, table in (("users", users), ("tasks", tasks), ("messages", messages)):
                result[name] = await connection.scalar(select(func.count()).select_from(table))
            print(json.dumps(result, sort_keys=True))
    finally:
        await engine.dispose()


asyncio.run(main())
