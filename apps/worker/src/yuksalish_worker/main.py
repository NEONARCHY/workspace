import asyncio

import structlog
from sqlalchemy.exc import SQLAlchemyError

from yuksalish_api.database import create_database_engine
from yuksalish_api.logging import configure_logging
from yuksalish_api.object_storage import MinioObjectStorage
from yuksalish_api.project_import_service import process_next_import
from yuksalish_api.settings import get_settings


async def serve() -> None:
    configure_logging()
    logger = structlog.get_logger("yuksalish_worker")
    logger.info("worker_ready")
    settings = get_settings()
    engine = create_database_engine(settings)
    storage = MinioObjectStorage(settings)
    try:
        await storage.ensure_ready()
        while True:
            try:
                processed = await process_next_import(
                    engine, storage, settings.gemini_api_key.get_secret_value(),
                )
            except SQLAlchemyError:
                logger.warning("project_import_database_unavailable")
                processed = False
            await asyncio.sleep(1 if processed else 5)
    finally:
        await engine.dispose()


def run() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    run()
