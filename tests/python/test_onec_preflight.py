"""Operator diagnostics fail closed and do not save credentials or financial records."""

import json
import sys
from pathlib import Path

import httpx
import pytest
from scripts.operations import onec_preflight

from yuksalish_api.onec_client import OneCConnection, OneCReadClient

EMPTY = b'''<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2009/11/edm"
  Namespace="StandardODATA"><EntityContainer Name="EnterpriseV8"/>
  </Schema></edmx:DataServices></edmx:Edmx>'''
VALID = EMPTY.replace(b'<EntityContainer Name="EnterpriseV8"/>', b'''
  <EntityType Name="Projects"><Property Name="Ref_Key" Type="Edm.Guid"/></EntityType>
  <EntityContainer Name="EnterpriseV8"><EntitySet Name="Projects"
  EntityType="StandardODATA.Projects"/></EntityContainer>''')


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.parametrize(("status", "content", "expected", "reason"), [
    (200, VALID, "available", None), (200, EMPTY, "blocked", "no_published_objects"),
    (200, b"<html>private login page</html>", "blocked", "invalid_metadata"),
    (401, b"private response body", "blocked", "authentication_required"),
])
async def test_preflight_has_explicit_outcomes_and_only_copies_requested_metadata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
    status: int, content: bytes, expected: str, reason: str | None,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, content=content)

    monkeypatch.setattr(onec_preflight, "OneCReadClient", lambda connection: OneCReadClient(
        connection, transport=httpx.MockTransport(handler),
    ))
    private_file = tmp_path / "private" / "metadata.xml"
    result = await onec_preflight.preflight(OneCConnection("https://one-c.example/Base"),
                                          private_file)
    assert result["status"] == expected
    assert result.get("reason") == reason
    assert result["financialDataRead"] is False
    assert result["writesEnabled"] is False
    assert result["httpStatus"] == status
    assert len(seen) == 1
    assert seen[0].method == "GET"
    if status == 200:
        assert private_file.read_bytes() == content
        assert len(str(result["metadataSha256"])) == 64
    else:
        assert not private_file.exists()
    if reason == "no_published_objects":
        assert result["entityCount"] == 0
    assert "private response body" not in json.dumps(result)


def test_cli_does_not_persist_password_or_emit_entity_inventory_to_console(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    private_file = tmp_path / "report.json"
    monkeypatch.setenv("YUKSALISH_ONEC_PASSWORD", "private-password")
    monkeypatch.setattr(sys, "argv", ["onec_preflight", "--base-url",
        "https://one-c.example/Base", "--username", "operator", "--output", str(private_file)])

    def factory(connection: OneCConnection) -> OneCReadClient:
        assert connection.password.get_secret_value() == "private-password"
        return OneCReadClient(connection, transport=httpx.MockTransport(
            lambda _: httpx.Response(200, content=VALID),
        ))

    monkeypatch.setattr(onec_preflight, "OneCReadClient", factory)
    assert onec_preflight.main() == 0
    saved = private_file.read_text(encoding="utf-8")
    console = capsys.readouterr().out
    assert "private-password" not in saved + console
    assert "operator" not in saved + console
    assert "entities" not in json.loads(console)
    assert json.loads(saved)["entities"][0]["name"] == "Projects"


def test_cli_empty_password_is_explicit_and_empty_publication_exits_unsuccessfully(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "argv", ["onec_preflight", "--base-url",
        "https://one-c.example/Base", "--username", "operator", "--empty-password"])

    def factory(connection: OneCConnection) -> OneCReadClient:
        assert connection.password.get_secret_value() == ""
        return OneCReadClient(connection, transport=httpx.MockTransport(
            lambda _: httpx.Response(200, content=EMPTY),
        ))

    monkeypatch.setattr(onec_preflight, "OneCReadClient", factory)
    assert onec_preflight.main() == 2
    result = json.loads(capsys.readouterr().out)
    assert result["reason"] == "no_published_objects"
    assert result["httpStatus"] == 200


@pytest.mark.parametrize("arguments", [[], ["--anonymous"],
    ["--base-url", "https://one-c.example/Base"],
    ["--base-url", "https://one-c.example/Base", "--anonymous", "--username", "operator"],
])
def test_cli_missing_or_conflicting_configuration_stops_before_network(
    monkeypatch: pytest.MonkeyPatch, arguments: list[str],
) -> None:
    monkeypatch.delenv("YUKSALISH_ONEC_BASE_URL", raising=False)
    monkeypatch.delenv("YUKSALISH_ONEC_USERNAME", raising=False)
    monkeypatch.setattr(sys, "argv", ["onec_preflight", *arguments])
    with pytest.raises(SystemExit, match="2"):
        onec_preflight.main()


def test_cli_rejects_invalid_connection_with_sanitized_nonzero_result(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "argv", ["onec_preflight", "--base-url",
        "http://one-c.example/Base", "--username", "operator", "--empty-password"])
    assert onec_preflight.main() == 2
    assert json.loads(capsys.readouterr().out) == {
        "status": "blocked", "reason": "invalid_configuration",
    }


def test_cli_report_io_failure_does_not_overwrite_or_claim_success(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    path = tmp_path / "report.json"
    path.write_text("keep this", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["onec_preflight", "--base-url",
        "https://one-c.example/Base", "--username", "operator", "--empty-password",
        "--output", str(path)])
    monkeypatch.setattr(onec_preflight, "OneCReadClient", lambda connection: OneCReadClient(
        connection, transport=httpx.MockTransport(lambda _: httpx.Response(200, content=VALID)),
    ))
    assert onec_preflight.main() == 2
    assert path.read_text(encoding="utf-8") == "keep this"
    assert json.loads(capsys.readouterr().out) == {
        "status": "blocked", "reason": "report_write_failed",
    }


def test_cli_stops_before_network_if_no_password_can_be_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("YUKSALISH_ONEC_PASSWORD", raising=False)
    monkeypatch.setattr(sys, "argv", ["onec_preflight", "--base-url",
        "https://one-c.example/Base", "--username", "operator"])

    def no_input(_: str) -> str:
        raise EOFError

    monkeypatch.setattr(onec_preflight.getpass, "getpass", no_input)
    with pytest.raises(SystemExit, match="2"):
        onec_preflight.main()


@pytest.mark.anyio
async def test_existing_private_file_is_never_overwritten(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    path = tmp_path / "existing.xml"
    path.write_text("keep this", encoding="utf-8")
    monkeypatch.setattr(onec_preflight, "OneCReadClient", lambda connection: OneCReadClient(
        connection, transport=httpx.MockTransport(lambda _: httpx.Response(200, content=VALID)),
    ))
    with pytest.raises(FileExistsError):
        await onec_preflight.preflight(OneCConnection("https://one-c.example/Base"), path)
    assert path.read_text(encoding="utf-8") == "keep this"
