"""Run forwarding regressions against an explicitly isolated local QA database."""

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from alembic import command
from alembic.config import Config

root = Path(__file__).resolve().parents[1]
url = os.environ.get("YUKSALISH_TEST_DATABASE_URL", "")
target = urlsplit(url)
if (
    target.hostname != "127.0.0.1"
    or target.port != 55439
    or target.path not in {"/workspace_qa", "/workspace_qa_compat"}
):
    raise SystemExit("Use only the isolated forwarding QA database on 127.0.0.1:55439/workspace_qa")
os.chdir(root)
os.environ["YUKSALISH_DATABASE_URL"] = url
sys.path.insert(0, str(root / "apps/api/src"))
config = Config(str(root / "apps/api/alembic.ini"))
# Alembic's legacy space separator breaks Windows checkouts with spaces.
config.set_main_option("path_separator", "os")
command.upgrade(config, "head")
raise SystemExit(pytest.main([
    "tests/python/test_forwarding.py",
    "tests/python/test_forwarding_postgres.py",
    "tests/python/test_forward_attachments_postgres.py",
    "--no-cov", "-q",
]))
