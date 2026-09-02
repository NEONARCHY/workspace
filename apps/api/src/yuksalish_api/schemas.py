from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["ok", "ready"]
    service: str
    version: str
    environment: str


class LocalizedLabel(BaseModel):
    model_config = ConfigDict(frozen=True)

    ru: str
    uz_cyrl: str
    uz_latn: str


class ModuleDescriptor(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    label: LocalizedLabel
    route: str
    status: Literal["placeholder", "available"]


class ModuleCatalogResponse(BaseModel):
    modules: list[ModuleDescriptor]
