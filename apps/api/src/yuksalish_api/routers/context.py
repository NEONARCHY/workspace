from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request

from yuksalish_api.auth import AuthenticatedUser, require_user
from yuksalish_api.context_schemas import ExchangeSnapshot, WeatherSnapshot
from yuksalish_api.context_service import ContextDataService
from yuksalish_api.errors import WorkspaceRepositoryError

router = APIRouter(prefix="/context", tags=["context"])
User = Annotated[AuthenticatedUser, Depends(require_user)]


@router.get("/exchange-rates", response_model=ExchangeSnapshot)
async def exchange_rates(request: Request, user: User) -> ExchangeSnapshot:
    del user
    try:
        return await cast(ContextDataService, request.app.state.context_service).exchange_rates()
    except WorkspaceRepositoryError as error:
        raise HTTPException(error.status_code, error.detail) from error


@router.get("/weather", response_model=WeatherSnapshot)
async def weather(request: Request, user: User) -> WeatherSnapshot:
    del user
    return await cast(ContextDataService, request.app.state.context_service).weather_snapshot()
