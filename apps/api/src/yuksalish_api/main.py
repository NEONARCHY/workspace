from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import RequestResponseEndpoint

from . import __version__
from .logging import configure_logging
from .routers import health, modules
from .settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        logger = structlog.get_logger("yuksalish_api")
        logger.info("api_started", environment=runtime_settings.environment, version=__version__)
        yield
        logger.info("api_stopped")

    application = FastAPI(
        title="Yuksalish Workspace API",
        version=__version__,
        docs_url="/docs" if runtime_settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    application.state.settings = runtime_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.cors_origins,
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
