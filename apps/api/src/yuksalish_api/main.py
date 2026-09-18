import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

import structlog
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import RequestResponseEndpoint

from . import __version__
from .absence_service import materialize_sick_document_notifications
from .database import create_database_engine
from .efficiency_service import materialize_efficiency_digest_notifications
from .events import WorkspaceEventBus
from .logging import configure_logging
from .object_storage import InMemoryObjectStorage, MinioObjectStorage
from .repository import materialize_due_notifications
from .routers import (
    administration,
    authentication,
    directory,
    health,
    members,
    messenger,
    modules,
    personal,
    updates,
    workspace,
    zoom,
)
from .seed import seed_demo_data
from .settings import Settings, get_settings
from .zoom_client import ZoomClient
from .zoom_service import materialize_zoom_reminders, recover_zoom_meetings


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(lifespan_app: FastAPI) -> AsyncIterator[None]:
        logger = structlog.get_logger("yuksalish_api")
        engine = create_database_engine(runtime_settings)
        lifespan_app.state.database_engine = engine
        lifespan_app.state.event_bus = WorkspaceEventBus()
        storage = (
            InMemoryObjectStorage()
            if runtime_settings.environment == "test"
            else MinioObjectStorage(runtime_settings)
        )
        await storage.ensure_ready()
        lifespan_app.state.object_storage = storage
        # One client keeps the OAuth token and the connection pool shared.
        zoom_client = ZoomClient(runtime_settings)
        lifespan_app.state.zoom_client = zoom_client
        # Demo fixtures are allowed only in the isolated test environment. A stale
        # production/development flag must never recreate sample employees.
        if runtime_settings.environment == "test" and runtime_settings.seed_demo_data:
            await seed_demo_data(engine, runtime_settings.demo_password)

        async def notification_scheduler() -> None:
            while True:
                try:
                    async with engine.begin() as connection:
                        created = await materialize_due_notifications(connection)
                        created += await materialize_efficiency_digest_notifications(connection)
                        created += await materialize_sick_document_notifications(connection)
                        created += await materialize_zoom_reminders(connection, runtime_settings)
                    if runtime_settings.zoom_configured:
                        # Bookings a crash or a Zoom outage left half-finished.
                        await recover_zoom_meetings(engine, zoom_client)
                    if created:
                        await lifespan_app.state.event_bus.publish(
                            {"type": "notifications.created", "count": created}
                        )
                except Exception:
                    logger.exception("notification_scheduler_failed")
                await asyncio.sleep(60)

        scheduler_task = asyncio.create_task(
            notification_scheduler(), name="workspace-notification-scheduler"
        )
        logger.info("api_started", environment=runtime_settings.environment, version=__version__)
        try:
            yield
        finally:
            scheduler_task.cancel()
            with suppress(asyncio.CancelledError):
                await scheduler_task
            await zoom_client.aclose()
            await engine.dispose()
            logger.info("api_stopped")

    application = FastAPI(
        title="Yuksalish Workspace API",
        version=__version__,
        docs_url="/docs" if runtime_settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    application.state.settings = runtime_settings
    cors_origins = list(runtime_settings.cors_origins)
    if runtime_settings.environment == "development" and "null" not in cors_origins:
        cors_origins.append("null")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "X-Desktop-Version",
            "X-Release-Version",
            "X-CSRF-Token",
        ],
    )

    @application.middleware("http")
    async def security_headers(request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    application.include_router(health.router, prefix=runtime_settings.api_prefix)
    application.include_router(members.router, prefix=runtime_settings.api_prefix)
    application.include_router(modules.router, prefix=runtime_settings.api_prefix)
    application.include_router(authentication.router, prefix=runtime_settings.api_prefix)
    application.include_router(directory.router, prefix=runtime_settings.api_prefix)
    application.include_router(workspace.router, prefix=runtime_settings.api_prefix)
    application.include_router(messenger.router, prefix=runtime_settings.api_prefix)
    application.include_router(administration.router, prefix=runtime_settings.api_prefix)
    application.include_router(personal.router, prefix=runtime_settings.api_prefix)
    application.include_router(updates.router, prefix=runtime_settings.api_prefix)
    application.include_router(zoom.router, prefix=runtime_settings.api_prefix)
    return application


app = create_app()


def run() -> None:
    settings = get_settings()
    uvicorn.run(
        "yuksalish_api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )


if __name__ == "__main__":
    run()
