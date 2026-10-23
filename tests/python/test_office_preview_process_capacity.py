"""Resource exhaustion is not document corruption; init must reap LO helper orphans."""

import importlib.util
import socketserver
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    # Windows does not expose UnixStreamServer. No sockets are opened by these
    # capacity/handler tests; the real Linux socket is tested in container QA.
    if not hasattr(socketserver, "UnixStreamServer"):
        monkeypatch.setattr(socketserver, "UnixStreamServer", socketserver.TCPServer, raising=False)
    spec = importlib.util.spec_from_file_location(
        "preview_service", ROOT / "services/office-preview/server.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "current,limit,expected",
    [(3, "128", True), (121, "128", False), (128, "128", False), (999, "max", True)],
)
def test_reserves_process_headroom(
    monkeypatch: pytest.MonkeyPatch, service: ModuleType,
    current: int, limit: str, expected: bool,
) -> None:
    monkeypatch.setattr(
        Path, "read_text", lambda path: str(current) if path.name == "pids.current" else limit
    )
    assert service.has_process_capacity() is expected


def test_non_cgroup_development_still_runs(
    monkeypatch: pytest.MonkeyPatch, service: ModuleType,
) -> None:
    monkeypatch.setattr(Path, "read_text", MagicMock(side_effect=OSError("no cgroup")))
    assert service.has_process_capacity()


def test_exhaustion_is_unready_and_never_attempts_conversion(
    monkeypatch: pytest.MonkeyPatch, service: ModuleType,
) -> None:
    monkeypatch.setattr(service, "has_process_capacity", lambda: False)
    convert = MagicMock()
    monkeypatch.setattr(service, "convert", convert)
    handler = SimpleNamespace(path="/ready", reply=MagicMock())
    service.Handler.do_GET(handler)
    handler.reply.assert_called_once_with(503, b"unavailable")
    handler.path = "/docx"
    handler.reply.reset_mock()
    service.Handler.do_POST(handler)
    assert handler.reply.call_args.args[0] == 503
    convert.assert_not_called()


@pytest.mark.parametrize("name", ["compose.yaml", "compose.local-dev.yaml"])
def test_converter_starts_under_init_in_every_environment(name: str) -> None:
    compose = (ROOT / "infrastructure" / name).read_text(encoding="utf-8")
    section = compose.split("  office-preview:\n", 1)[1].split("\n  postgres:", 1)[0]
    assert "    init: true\n" in section
    assert "    pids_limit: 128\n" in section
    assert "    network_mode: none\n" in section
