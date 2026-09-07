import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any, cast
from uuid import uuid4


class _TaskRows:
    def __init__(self, task: dict[str, object]) -> None:
        self._task = task

    def mappings(self) -> list[dict[str, object]]:
        return [self._task]


class _MigrationConnection:
    def __init__(self, task: dict[str, object]) -> None:
        self._task = task
        self.event_parameters: dict[str, object] | None = None

    def execute(
        self, statement: object, parameters: dict[str, object] | None = None
    ) -> _TaskRows | None:
        statement_text = str(statement)
        if statement_text.startswith("SELECT id, status"):
            return _TaskRows(self._task)

        compiled = cast(Any, statement).compile()
        compiled.construct_params(parameters or {})
        if "INSERT INTO task_efficiency_events" in statement_text:
            self.event_parameters = parameters
        return None


class _MigrationOperations:
    def __init__(self, connection: _MigrationConnection) -> None:
        self._connection = connection

    def create_table(self, *_args: object, **_kwargs: object) -> None:
        return None

    def create_index(self, *_args: object, **_kwargs: object) -> None:
        return None

    def get_bind(self) -> _MigrationConnection:
        return self._connection


def _load_migration() -> ModuleType:
    migration_path = (
        Path(__file__).parents[2]
        / "apps"
        / "api"
        / "migrations"
        / "versions"
        / "0018_employee_efficiency.py"
    )
    spec = importlib.util.spec_from_file_location("employee_efficiency_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_existing_tasks_can_be_backfilled_during_efficiency_upgrade() -> None:
    migration = _load_migration()
    now = datetime.now(UTC)
    connection = _MigrationConnection(
        {
            "id": uuid4(),
            "status": "in_progress",
            "due_at": now,
            "primary_assignee_user_id": uuid4(),
            "created_at": now,
        }
    )
    migration_object = cast(Any, migration)
    migration_object.op = _MigrationOperations(connection)

    migration_object.upgrade()

    assert connection.event_parameters is not None
    assert connection.event_parameters["old_value"] == "{}"
    assert connection.event_parameters["metadata"] == (
        '{"historyBeforeSnapshotKnown": false}'
    )
