from fastapi import APIRouter, Request

from yuksalish_api import __version__
from yuksalish_api.schemas import HealthResponse

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", response_model=HealthResponse, response_model_exclude_none=True)
async def live(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        status="ok",
        service="yuksalish-api",
        version=__version__,
        environment=settings.environment,
        deployment_id=settings.deployment_id,
    )


@router.get("/ready", response_model=HealthResponse, response_model_exclude_none=True)
async def ready(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        status="ready",
        service="yuksalish-api",
        version=__version__,
        environment=settings.environment,
        deployment_id=settings.deployment_id,
    )
