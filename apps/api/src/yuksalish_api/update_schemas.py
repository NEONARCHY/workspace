from datetime import datetime

from .workspace_schemas import ApiModel


class DesktopReleaseResponse(ApiModel):
    version: str
    file_name: str
    sha512: str
    size_bytes: int
    uploaded_at: datetime
    published_at: datetime | None = None


class DesktopUpdatePolicyResponse(ApiModel):
    published_version: str | None = None
    minimum_version: str | None = None
    mandatory: bool = False
    updated_at: datetime | None = None
    release: DesktopReleaseResponse | None = None


class MandatoryUpdateRequest(ApiModel):
    mandatory: bool
