"""Reviewer validation and isolated Exat adapter tests: no network or real robot DB."""

import importlib
import json
import sqlite3
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from yuksalish_api.ai_referent_configuration_schemas import ReviewerConfigurationUpdate
from yuksalish_api.ai_referent_configuration_service import require_configuration_admin
from yuksalish_api.auth import AuthenticatedUser

ROOT = Path(__file__).resolve().parents[2]
KEYS = ("askar", "bobur", "umid", "davronbek")


def configuration(revision=2):
    return {
        "revision": revision,
        "reviewers": [
            {
                "key": key,
                "fullName": f"Reviewer {index}",
                "username": f"reviewer_{index}",
                "userId": str(uuid4()),
                "telegramId": str(1001 + index),
                "enabled": True,
                "accountActive": True,
                "canApprove": True,
            }
            for index, key in enumerate(KEYS)
        ],
    }


def test_configuration_requires_unique_complete_bindings_and_numeric_ids():
    rows = [
        {"key": key, "username": f"reviewer_{index}", "telegramId": str(index + 1), "enabled": True}
        for index, key in enumerate(KEYS)
    ]
    rows[0]["username"] = " @ASKAR_MAMATXANOV "
    parsed = ReviewerConfigurationUpdate(expectedRevision=1, reviewers=rows)
    assert parsed.reviewers[0].username == "askar_mamatxanov"
    for patch in (
        {"key": "bobur"},
        {"username": "reviewer_1"},
        {"telegramId": "2"},
        {"username": ""},
        {"telegramId": "@someone"},
        {"telegramId": "-55"},
    ):
        invalid = deepcopy(rows)
        invalid[0].update(patch)
        with pytest.raises(ValidationError):
            ReviewerConfigurationUpdate(expectedRevision=1, reviewers=invalid)
    with pytest.raises(ValidationError):
        ReviewerConfigurationUpdate(expectedRevision=1, reviewers=rows[:3])


@pytest.mark.parametrize("role", ["employee", "manager", "admin", "superadmin"])
def test_only_actual_admin_can_change_bindings(role):
    user = AuthenticatedUser(
        id=uuid4(),
        username="user",
        full_name="User",
        role=role,
        position_id=None,
        job_title="Director",
    )
    if role in {"admin", "superadmin"}:
        require_configuration_admin(user)
    else:
        with pytest.raises(HTTPException) as error:
            require_configuration_admin(user)
        assert error.value.status_code == 403


@pytest.fixture
def adapter(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "integrations/exat"))
    module = importlib.import_module("workspace_integration.runtime")
    monkeypatch.setattr(module, "legacy_bindings", lambda: {})
    return module


@pytest.fixture
def service(tmp_path):
    path = tmp_path / "robot.sqlite"

    @contextmanager
    def connect():
        connection = sqlite3.connect(path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

    with connect() as connection:
        connection.executescript("""
            CREATE TABLE outgoing_review_requests (
                id INTEGER PRIMARY KEY, reviewer_telegram_id TEXT, reviewer_name TEXT,
                final_reviewer_telegram_id TEXT, final_reviewer_name TEXT, status TEXT,
                reviewer_prompt_message_id TEXT, updated_at TEXT, outgoing_id INTEGER
            );
            CREATE TABLE outgoing_review_events (
                review_request_id INTEGER, event_time TEXT, event_type TEXT,
                event_message TEXT, extra_json TEXT
            );
        """)
        connection.executemany(
            "INSERT INTO outgoing_review_requests VALUES "
            "(?, '1001', 'Old', '1002', 'Final', ?, '10', '', NULL)",
            [
                (1, "waiting_review"),
                (2, "awaiting_comment"),
                (3, "approved_formalized"),
                (4, "needs_sender_revision"),
                (5, "awaiting_final_send"),
            ],
        )
        connection.commit()
    instance = SimpleNamespace(
        database=SimpleNamespace(connect=connect),
        outgoing_settings={
            "telegram": {
                "reviewers": [
                    {"key": "askar", "telegram_id": "1001"},
                    {"key": "bobur", "telegram_id": "1002"},
                ]
            },
        },
    )
    instance.reviewers = lambda: instance.outgoing_settings["telegram"]["reviewers"]
    return instance


def test_robot_reassigns_open_decisions_keeps_history_and_can_reenable(adapter, service):
    config = configuration()
    adapter.apply_configuration(service, config)
    changed = deepcopy(config)
    changed["revision"] = 3
    changed["reviewers"][0]["telegramId"] = "2001"
    changed["reviewers"][0]["fullName"] = "New reviewer"
    assert adapter.apply_configuration(service, changed) == [1, 2, 4, 5]
    with service.database.connect() as connection:
        rows = {
            row["id"]: row for row in connection.execute("SELECT * FROM outgoing_review_requests")
        }
        assert rows[1]["reviewer_telegram_id"] == "2001"
        assert rows[2]["status"] == "waiting_review"
        assert rows[3]["reviewer_telegram_id"] == "1001"
        assert rows[4]["status"] == "needs_sender_revision"
        assert rows[5]["status"] == "awaiting_final_send"
        assert rows[1]["reviewer_prompt_message_id"] is None
    disabled = deepcopy(changed)
    disabled["reviewers"][0]["enabled"] = False
    adapter.apply_configuration(service, disabled)
    with service.database.connect() as connection:
        assert (
            connection.execute(
                "SELECT reviewer_telegram_id FROM outgoing_review_requests WHERE id=1"
            ).fetchone()[0]
            == "disabled:askar"
        )
    adapter.apply_configuration(service, changed)
    assert adapter.apply_configuration(service, changed) == []
    with service.database.connect() as connection:
        assert (
            connection.execute(
                "SELECT reviewer_telegram_id FROM outgoing_review_requests WHERE id=1"
            ).fetchone()[0]
            == "2001"
        )


def test_robot_swaps_slots_and_rejects_stale_draft_recipient(adapter, service, monkeypatch):
    config = configuration()
    adapter.apply_configuration(service, config)
    config["reviewers"][0]["telegramId"], config["reviewers"][1]["telegramId"] = "1002", "2002"
    adapter.apply_configuration(service, config)
    with service.database.connect() as connection:
        row = connection.execute("SELECT * FROM outgoing_review_requests WHERE id=1").fetchone()
        assert row["reviewer_telegram_id"] == "1002"
        assert row["final_reviewer_telegram_id"] == "2002"
    monkeypatch.setattr(
        adapter, "connection_settings", lambda: {"api_url": "https://workspace.test"}
    )
    with pytest.raises(ValueError, match="Согласующий изменён"):
        adapter.validate_recipient(service, SimpleNamespace(reviewer_telegram_id="1001"))
    adapter.validate_recipient(service, SimpleNamespace(reviewer_telegram_id="1002"))
    assert adapter.final_reviewer_matches(service, "2002", False)
    assert not adapter.final_reviewer_matches(service, "1002", True)
    assert adapter.is_bobur({"key": "askar", "name": "Bobur"}) is False
    assert adapter.is_preliminary({"key": "davronbek"}) is True


def test_robot_revocation_without_configuration_revision_change(adapter, service, monkeypatch):
    config = configuration()
    client = Mock()
    client.configuration.return_value = config
    monkeypatch.setattr(adapter, "WorkspaceClient", lambda: client)
    monkeypatch.setattr(
        adapter, "connection_settings", lambda: {"api_url": "https://workspace.test"}
    )
    monkeypatch.setattr(adapter, "notify_reassigned", Mock())
    monkeypatch.setattr(adapter.time, "sleep", Mock())
    bot = SimpleNamespace(service=service, _status_log=Mock(), _queue_processing=False)
    assert adapter.refresh_bot(bot)
    revoked = deepcopy(config)
    revoked["reviewers"][0]["canApprove"] = False
    client.configuration.return_value = revoked
    assert adapter.refresh_bot(bot)
    assert "1001" not in {item["telegram_id"] for item in service.reviewers()}
    client.configuration.side_effect = adapter.WorkspaceError("unavailable")
    assert not adapter.refresh_bot(bot)
    assert service.outgoing_settings["workspace_configuration_bindings"] == revoked["reviewers"]


def test_robot_defers_update_during_running_send(adapter, service, monkeypatch):
    client = Mock()
    client.configuration.return_value = configuration()
    monkeypatch.setattr(adapter, "WorkspaceClient", lambda: client)
    monkeypatch.setattr(
        adapter, "connection_settings", lambda: {"api_url": "https://workspace.test"}
    )
    monkeypatch.setattr(adapter.time, "sleep", Mock())
    bot = SimpleNamespace(service=service, _status_log=Mock(), _queue_processing=True)
    assert not adapter.refresh_bot(bot)
    client.acknowledge.assert_not_called()


def test_robot_never_guesses_an_unknown_historical_reviewer(adapter, service):
    with service.database.connect() as connection:
        connection.execute(
            "UPDATE outgoing_review_requests SET reviewer_telegram_id='9999' WHERE id=2"
        )
        connection.commit()
    with pytest.raises(adapter.WorkspaceError, match="отсутствует сопоставление"):
        adapter.apply_configuration(service, configuration())
    with service.database.connect() as connection:
        # Earlier rows in the same transaction were rolled back as well.
        assert (
            connection.execute(
                "SELECT reviewer_name FROM outgoing_review_requests WHERE id=1"
            ).fetchone()[0]
            == "Old"
        )


def test_robot_rejects_ambiguous_initial_roles_but_uses_saved_mapping(
    adapter, service, monkeypatch
):
    monkeypatch.setattr(adapter, "legacy_bindings", lambda: {"askar": "1001", "bobur": "1001"})
    with pytest.raises(adapter.WorkspaceError, match="назначен нескольким ролям"):
        adapter.apply_configuration(service, configuration())
    with service.database.connect() as connection:
        assert (
            connection.execute(
                "SELECT reviewer_name FROM outgoing_review_requests WHERE id=1"
            ).fetchone()[0]
            == "Old"
        )
    monkeypatch.setattr(adapter, "legacy_bindings", lambda: {"askar": "1001", "bobur": "1002"})
    config = configuration()
    adapter.apply_configuration(service, config)
    # The stored explicit role snapshot takes precedence over obsolete local settings.
    monkeypatch.setattr(adapter, "legacy_bindings", lambda: {"askar": "1002", "bobur": "1002"})
    config["reviewers"][0]["telegramId"] = "2001"
    adapter.apply_configuration(service, config)
    with service.database.connect() as connection:
        row = connection.execute("SELECT * FROM outgoing_review_requests WHERE id=1").fetchone()
        assert row["reviewer_telegram_id"] == "2001"
        assert row["final_reviewer_telegram_id"] == "1002"


def test_reassignment_notification_retries_durably(adapter, service):
    config = configuration()
    adapter.apply_configuration(service, config)
    bot = SimpleNamespace(
        service=service,
        _notify_reviewer_or_offer_retry=Mock(return_value={"status": "failed"}),
        _notify_signed_or_offer_retry=Mock(return_value={"status": "sent"}),
    )

    def request(review_id):
        with service.database.connect() as connection:
            return dict(
                connection.execute(
                    "SELECT * FROM outgoing_review_requests WHERE id=?", (review_id,)
                ).fetchone()
            )

    service.get_review_request = request
    service._letter_payload = lambda _id: {}
    with service.database.connect() as connection:
        connection.execute("UPDATE outgoing_review_requests SET outgoing_id=1 WHERE id=5")
        connection.commit()
    adapter.notify_reassigned(bot)
    with service.database.connect() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM workspace_reviewer_notifications").fetchone()[
                0
            ]
            == 2
        )
        connection.execute("UPDATE workspace_reviewer_notifications SET last_attempt=0")
        connection.commit()
    bot._notify_reviewer_or_offer_retry.return_value = {"status": "sent"}
    adapter.notify_reassigned(bot)
    with service.database.connect() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM workspace_reviewer_notifications").fetchone()[
                0
            ]
            == 0
        )


def test_client_forbids_plain_http_credentials_and_redirects(adapter):
    client_module = importlib.import_module("workspace_integration.client")
    for url in ("http://host", "https://user:password@host", "https://host?token=secret", ""):
        with pytest.raises(client_module.WorkspaceError):
            client_module.validate_url(url)
    assert client_module.validate_url("https://workspace.test/") == "https://workspace.test/api/v1"
    with pytest.raises(client_module.WorkspaceError):
        client_module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.test")


@pytest.mark.parametrize("role", ["employee", "admin", "superadmin"])
def test_client_closes_session_if_logged_in_user_is_not_admin(adapter, role):
    client_module = importlib.import_module("workspace_integration.client")
    client = client_module.WorkspaceClient(
        settings={"api_url": "https://workspace.test"}, token="test-agent"
    )
    client.request = Mock(return_value={"accessToken": "test-session", "user": {"role": role}})
    client.logout = Mock()
    if role == "employee":
        with pytest.raises(client_module.WorkspaceError) as forbidden:
            client.login("@account", "test-password")
        assert forbidden.value.status == 403
        client.logout.assert_called_once_with("test-session")
        client.logout.side_effect = client_module.WorkspaceError("unavailable")
        with pytest.raises(client_module.WorkspaceError, match="Ошибка закрытия сеанса"):
            client.login("@account", "test-password")
    else:
        assert client.login("@account", "test-password") == "test-session"
        client.logout.assert_not_called()


def test_installer_rejects_unknown_source_without_writing(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    installer = importlib.import_module("install_exat_workspace")
    (tmp_path / "src").mkdir()
    path = tmp_path / "src/gui.py"
    path.write_text("# unknown robot version", encoding="utf-8")
    with pytest.raises(ValueError):
        installer.install(tmp_path, apply=True)
    assert path.read_text(encoding="utf-8") == "# unknown robot version"
    assert not (tmp_path / ".workspace-integration-backups").exists()


def test_installer_is_dry_by_default_backed_up_and_idempotent(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    installer = importlib.import_module("install_exat_workspace")
    sources = {
        "src/gui.py": (
            "class Gui:\n    def init(self):\n"
            "        self.root.after(900, self._auto_start_outgoing_telegram_bot)\n"
            "    def save_outgoing_reviewer_settings(self) -> None:\n        pass\n"
        ),
        "src/outgoing/service.py": (
            "class Service:\n"
            "    def reviewers(self) -> list[dict[str, str]]:\n        return []\n"
            "    def create_review_request(self, request: OutgoingReviewRequestCreate)"
            " -> dict[str, Any]:\n"
            "        pass\n"
            "    def create_from_draft(self, request: OutgoingCreateRequest) -> dict[str, Any]:\n"
            "        pass\n"
            "    def handle_review(self):\n        pass\n"
            "    def confirm_manual_send(self):\n        pass\n"
            "    def approve_review_request(self):\n"
            "        defer_send = bool(self.outgoing_settings.get("
            '"bobur_final_send_confirmation", False)) and (\n'
            '            str(row["reviewer_telegram_id"] or "").strip() '
            "== BOBUR_REVIEWER_TELEGRAM_ID\n"
            "        )\n"
        ),
        "src/outgoing/telegram_bot.py": (
            "class Bot:\n"
            "    def _is_allowed_actor(self, from_user: dict[str, Any] | None, "
            'chat_id: str = "") -> bool:\n'
            "        return False\n"
            "    def run_polling(self, max_updates=None, stop_after_idle_seconds=None):\n"
            "        last_exat_reconcile_check = 0.0\n        while True:\n"
            "            for update in updates:\n                pass\n"
            "def _is_bobur_reviewer_entry(entry: dict[str, Any] | None) -> bool:\n    return True\n"
            "def _is_preliminary_reviewer_entry(entry: dict[str, Any] | None) -> bool:\n"
            "    return False\n"
        ),
    }
    for relative, content in sources.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    preview = installer.install(tmp_path)
    assert len(preview["changedFiles"]) == 3 + len(list(installer.PACKAGE.glob("*.py")))
    assert not (tmp_path / "src/workspace_integration").exists()
    result = installer.install(tmp_path, apply=True)
    backup = Path(result["backup"])
    assert (backup / "manifest.json").exists()
    for relative, content in sources.items():
        assert (backup / relative).read_text(encoding="utf-8") == content
        assert installer.MARKER in (tmp_path / relative).read_text(encoding="utf-8")
    assert installer.install(tmp_path, apply=True)["changedFiles"] == []


def test_gui_source_keeps_password_out_of_connection_file(adapter, tmp_path, monkeypatch):
    client_module = importlib.import_module("workspace_integration.client")
    settings = tmp_path / "workspace.json"
    settings.write_text(json.dumps({"api_url": "https://workspace.test", "agent_id": "pc-2"}))
    monkeypatch.setattr(client_module, "connection_path", lambda: settings)
    monkeypatch.delenv("YUKSALISH_API_BASE_URL", raising=False)
    assert client_module.connection_settings()["agent_id"] == "pc-2"
