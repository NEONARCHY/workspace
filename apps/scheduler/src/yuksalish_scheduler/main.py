import asyncio

import structlog

from yuksalish_api.database import create_database_engine
from yuksalish_api.logging import configure_logging
from yuksalish_api.repository import materialize_due_task_cycles
from yuksalish_api.settings import get_settings


async def serve() -> None:
    configure_logging()
    logger = structlog.get_logger("yuksalish_scheduler")
    engine = create_database_engine(get_settings())
    logger.info("scheduler_ready", jobs=["task_cycles"])
    try:
        while True:
            try:
                async with engine.begin() as connection:
                    created = await materialize_due_task_cycles(connection)
                if created:
                    logger.info("task_cycle_occurrences_created", count=created)
            except Exception:
                logger.exception("task_cycle_materialization_failed")
            await asyncio.sleep(30)
    finally:
        await engine.dispose()


def run() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    run()
