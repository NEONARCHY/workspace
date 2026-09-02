from fastapi import APIRouter

from yuksalish_api.catalog import MODULE_CATALOG
from yuksalish_api.schemas import ModuleCatalogResponse

router = APIRouter(prefix="/modules", tags=["modules"])


@router.get("", response_model=ModuleCatalogResponse)
async def list_modules() -> ModuleCatalogResponse:
    return ModuleCatalogResponse(modules=list(MODULE_CATALOG))
