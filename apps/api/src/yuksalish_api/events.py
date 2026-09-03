from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import WebSocket


class WorkspaceEventBus:
    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: UUID, websocket: WebSocket) -> None:
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: UUID, websocket: WebSocket) -> None:
        connections = self._connections.get(user_id)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(user_id, None)

    async def publish(self, event: dict[str, Any]) -> None:
        stale: list[tuple[UUID, WebSocket]] = []
        for user_id, connections in tuple(self._connections.items()):
            for websocket in tuple(connections):
                try:
                    await websocket.send_json(event)
                except RuntimeError:
                    stale.append((user_id, websocket))
        for user_id, websocket in stale:
            self.disconnect(user_id, websocket)
