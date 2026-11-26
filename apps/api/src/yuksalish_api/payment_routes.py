"""Project payment-route snapshots; unrelated workflow stages stay in the published graph."""

from collections.abc import Mapping
from typing import Any

from .position_policy import is_calendar_chairman, is_task_chat_leader

ROUTE_ACTORS = "payment_route_approvers"
ROUTE_STEP = "payment_route_step"


def is_payment_deputy(job_title: str | None) -> bool:
    return is_task_chat_leader(job_title) and not is_calendar_chairman(job_title)


def payment_route_actors(payload: Mapping[str, Any]) -> list[dict[str, str]] | None:
    value = payload.get(ROUTE_ACTORS)
    if not isinstance(value, list):
        return None
    return [{"user_id": str(actor["user_id"]), "name": str(actor["name"])} for actor in value]


def payment_route_step(payload: Mapping[str, Any]) -> int:
    value = payload.get(ROUTE_STEP, 0)
    return value if isinstance(value, int) and value >= 0 else 0


def payment_route_actor(payload: Mapping[str, Any]) -> dict[str, str] | None:
    actors = payment_route_actors(payload)
    step = payment_route_step(payload)
    return actors[step] if actors and step < len(actors) else None
