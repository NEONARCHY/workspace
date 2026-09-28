"""Conservative agent-side authority maintenance for the offline workflow.

This control plane does not execute letters. The data plane must use ``mode``
and the durable rights journal before it is wired into the running bot.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Literal

from .client import WorkspaceClient, WorkspaceError
from .offline_authority import OfflineAuthorityGate
from .offline_journal import OfflineJournal

AuthorityMode = Literal["legacy", "online", "waiting", "offline", "replay", "blocked"]


class OfflineCoordinator:
    def __init__(
        self,
        client: WorkspaceClient,
        journal: OfflineJournal,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.client = client
        self.journal = journal
        self.clock = clock
        self.gate = OfflineAuthorityGate(journal, client.agent_id, clock=clock)
        self._next_refresh = 0.0

    def _verified_rights(self, epoch: str) -> bool:
        evidence = self.journal.offline_rights_evidence()
        return evidence is not None and evidence["epoch"] == epoch

    def _refresh(self, epoch: str) -> None:
        if self.clock() < self._next_refresh:
            return
        # Save the request IDs before network access. A lost response repeats
        # the same request and cannot silently pick up different rights/ranges.
        snapshot_id = self.journal.prepare_offline_rights(epoch)
        self.journal.save_offline_rights(self.client.offline_rights(epoch, snapshot_id))
        if self.journal.available_reserved_numbers(self.client.agent_id) < 5:
            reservation_id = self.journal.prepare_number_reservation(self.client.agent_id, 20)
            self.journal.save_number_reservation(
                self.client.reserve_offline_numbers(reservation_id, 20, epoch)
            )
        self._next_refresh = self.clock() + 30

    def tick(self) -> AuthorityMode:
        """Heartbeat while connected; fail over only after the server's fence expires."""
        state = self.journal.authority_state()
        if state is None:
            try:
                lease = self.client.start_offline_authority()
            except WorkspaceError as error:
                if error.status == 409 and "пока не включён" in str(error):
                    return "legacy"
                return "blocked"
            self.gate.accept_lease(lease)
            state = self.journal.authority_state()
        elif state["agent_id"] != self.client.agent_id:
            return "blocked"
        elif state["phase"] == "replay":
            return "replay"
        elif state["phase"] == "offline":
            try:
                self.gate.accept_lease(self.client.start_offline_authority())
            except WorkspaceError as error:
                if error.retryable and self._verified_rights(state["epoch"]):
                    return "offline"
                return "blocked"
            except ValueError:
                return "blocked"
            return "replay"
        else:
            try:
                self.gate.accept_lease(
                    self.client.heartbeat_offline_authority(state["epoch"])
                )
            except WorkspaceError as error:
                if error.retryable:
                    if self._verified_rights(state["epoch"]) and self.gate.may_write_offline():
                        return "offline"
                    return "waiting"
                if error.status == 409:
                    # A recovered server may have fenced the old lease before
                    # this process durably entered offline mode. Discover its
                    # replay-required phase instead of remaining blocked forever.
                    try:
                        self.gate.accept_lease(self.client.start_offline_authority())
                    except (WorkspaceError, ValueError):
                        return "blocked"
                    refreshed = self.journal.authority_state()
                    if refreshed is not None and refreshed["phase"] == "replay":
                        return "replay"
                    if refreshed is not None and refreshed["phase"] == "online":
                        return "online"
                return "blocked"
            except ValueError:
                return "blocked"
        state = self.journal.authority_state()
        if state is None or state["phase"] != "online":
            return "replay" if state and state["phase"] == "replay" else "blocked"
        try:
            self._refresh(state["epoch"])
        except WorkspaceError as error:
            if not error.retryable:
                return "blocked"
        except ValueError:
            return "blocked"
        return "online"
