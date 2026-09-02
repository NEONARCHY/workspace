import asyncio

import structlog

from yuksalish_api.logging import configure_logging


async def serve() -> None:
    configure_logging()
    logger = structlog.get_logger("yuksalish_scheduler")
    logger.info("scheduler_ready")
    while True:
        await asyncio.sleep(3600)


def run() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    run()
