from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from .workspace_schemas import ApiModel


class DeliveryLease(ApiModel):
    model_config = ConfigDict(extra="forbid")
    lease_token: UUID


class DeliveryClaim(DeliveryLease):
    id: UUID


class ClaimMode(ApiModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["preview", "live"] = "preview"


class PreparedDelivery(ApiModel):
    id: UUID
    telegram_id: str
    text: str
    button_text: str
    url: str
    send_allowed: bool
    expires_at: datetime


class DeliveryAck(DeliveryLease):
    outcome: Literal["sent", "preview", "retry", "blocked", "failed", "unknown"]
    telegram_message_id: int | None = Field(default=None, gt=0)
    retry_after: int = Field(default=30, ge=1, le=3600)

    @model_validator(mode="after")
    def receipt(self) -> "DeliveryAck":
        if (self.outcome == "sent") != (self.telegram_message_id is not None):
            raise ValueError("Only a confirmed send has a Telegram message ID")
        return self


class WorkspaceNoticeTarget(ApiModel):
    section: Literal["tasks", "payment_requests", "ai_referent"]
    entity_id: str
