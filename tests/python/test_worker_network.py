"""Validate the resolved deployment graph without loading real environment files."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("overrides", [
    [],
    ["compose.lan.yaml"],
    ["compose.lan.yaml", "compose.cloudflare.yaml"],
])
def test_import_worker_has_isolated_egress_without_published_ports(
    overrides: list[str],
) -> None:
    executable = shutil.which("docker")
    if not executable:
        pytest.skip("Docker Compose CLI is not installed")
    command = [executable, "compose", "-f", str(ROOT / "infrastructure" / "compose.yaml")]
    for override in overrides:
        command.extend(["-f", str(ROOT / "infrastructure" / override)])
    # No daemon is needed; no real credentials/env_file contents enter the result.
    command.extend(["config", "--no-env-resolution", "--no-interpolate", "--format", "json"])
    result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=30)
    configuration = json.loads(result.stdout)
    services = configuration["services"]
    worker = services["worker"]
    assert set(worker["networks"]) == {"backend", "worker-egress"}
    assert not worker.get("ports")
    assert configuration["networks"]["backend"]["internal"] is True
    assert not configuration["networks"]["worker-egress"].get("internal", False)
    assert services["api"]["networks"].keys() == {"backend", "api-egress"}
    for name, service in services.items():
        if name != "worker":
            assert "worker-egress" not in service.get("networks", {})
    for name in ("postgres", "redis", "minio"):
        assert "backend" in services[name]["networks"]
        assert "edge" not in services[name]["networks"]
