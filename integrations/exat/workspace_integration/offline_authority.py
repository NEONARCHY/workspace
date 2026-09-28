"""Conservative local gate for a future autonomous bot workflow.

The live bot does not instantiate this class yet. The gate never grants offline
writes from a wall-clock timestamp after a restart: only a durable offline
transition made after a monotonic wait survives process loss.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import datetime
from typing import Any
from uuid import UUID

from .offline_journal import OfflineJournal

SAFETY_SECONDS = 5


class OfflineAuthorityGate:
    def __init__(
        self, journal: OfflineJournal, agent_id: str, *, clock: Callable[[], float] = time.monotonic
    ):
        self.journal = journal
        self.agent_id = agent_id
        self.clock = clock
        self._deadline: float | None = None
        state = journal.authority_state()
        if state is not None and state["agent_id"] == agent_id and state["phase"] == "online":
            seconds = state["lease_seconds"]
            if isinstance(seconds, int) and 1 <= seconds <= 600:
                # On process restart, wait a whole lease from *this* boot. The
                # old monotonic deadline cannot be reconstructed from wall time.
                self._deadline = self.clock() + seconds + SAFETY_SECONDS

    def accept_lease(self, response: dict[str, Any]) -> None:
        """Accept a server-confirmed epoch but do not grant offline writes yet."""
        epoch = str(UUID(str(response["epoch"])))
        mode = response["mode"]
        seconds = int(response["leaseSeconds"])
        server_time = datetime.fromisoformat(
            str(response["serverTime"]).replace("Z", "+00:00")
        )
        lease_until = datetime.fromisoformat(
            str(response["leaseUntil"]).replace("Z", "+00:00")
        )
        if (
            seconds < 1 or seconds > 600 or server_time.tzinfo is None
            or lease_until.tzinfo is None
        ):
            raise ValueError("Сервер вернул недействительную аренду робота.")
        remaining = (lease_until - server_time).total_seconds()
        if remaining > seconds + 1:
            raise ValueError("Сервер вернул недействительную аренду робота.")
        if mode == "replay_required":
            self.journal.set_authority_phase(self.agent_id, epoch, "replay")
            self._deadline = None
            return
        if mode != "online" or remaining <= 0:
            raise ValueError("Сервер не подтвердил действующую аренду.")
        self.journal.set_authority_phase(
            self.agent_id, epoch, "online", lease_seconds=seconds
        )
        # The response was generated before receipt, so waiting the *full*
        # lease from receipt plus slack is conservative even with clock skew.
        self._deadline = self.clock() + seconds + SAFETY_SECONDS

    def may_write_offline(self) -> bool:
        state = self.journal.authority_state()
        if state is None or state["agent_id"] != self.agent_id:
            return False
        if state["phase"] == "offline":
            return True
        if state["phase"] != "online" or self._deadline is None:
            return False
        if self.clock() < self._deadline:
            return False
        self.journal.set_authority_phase(self.agent_id, state["epoch"], "offline")
        return True
