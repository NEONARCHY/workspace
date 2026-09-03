from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import RequestResponseEndpoint

from . import __version__
from .database import create_database_engine
from .events import WorkspaceEventBus
from .logging import configure_logging
from .routers import authentication, health, modules, workspace
from .seed import seed_demo_data
from .settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(lifespan_app: FastAPI) -> AsyncIterator[None]:
        logger = structlog.get_logger("yuksalish_api")
        engine = create_database_engine(runtime_settings)
        lifespan_app.state.database_engine = engine
        lifespan_app.state.event_bus = WorkspaceEventBus()
        if runtime_settings.seed_demo_data:
            await seed_demo_data(engine, runtime_settings.demo_password)
        logger.info("api_started", environment=runtime_settings.environment, version=__version__)
        try:
            yield
        finally:
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
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
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
    application.include_router(modules.router, prefix=runtime_settings.api_prefix)
    application.include_router(authentication.router, prefix=runtime_settings.api_prefix)
    application.include_router(workspace.router, prefix=runtime_settings.api_prefix)
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
