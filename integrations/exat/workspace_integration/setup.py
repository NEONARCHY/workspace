"""Explicit activation, after backup and old pending decisions have been reconciled."""

import argparse
import json

from .client import WorkspaceClient, connection_path
from .state import State
from .worker import DeliveryWorker


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enable-shared-workflow", action="store_true", required=True)
    args = parser.parse_args()
    if not args.enable_shared_workflow:
        return
    from src.outgoing.service import OutgoingWorkflowService

    client = WorkspaceClient()
    path = connection_path()
    service = OutgoingWorkflowService()
    state = State(path.parent / "shared-state.sqlite")
    DeliveryWorker(service, client, state).bootstrap()
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data["shared_workflow"] = "true"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
    print("Общий режим включён. Запустите один экземпляр Telegram-бота из GUI Exat.")


if __name__ == "__main__":
    main()
