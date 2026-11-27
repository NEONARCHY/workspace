"""Inspect published 1C metadata without reading transactions or writing either system."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import hashlib
import json
import os
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from pydantic import SecretStr

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api" / "src"))

from yuksalish_api.onec_client import OneCConnection, OneCError, OneCReadClient, parse_metadata


async def preflight(connection: OneCConnection, metadata_output: Path | None) -> dict[str, object]:
    report: dict[str, object] = {
        "checkedAt": datetime.now(UTC).isoformat(), "mode": "metadata_only",
        "financialDataRead": False, "writesEnabled": False,
    }
    try:
        async with OneCReadClient(connection) as client:
            document = await client.metadata_xml()
        report.update(httpStatus=200, metadataSha256=hashlib.sha256(document).hexdigest())
        if metadata_output:
            metadata_output.parent.mkdir(parents=True, exist_ok=True)
            with metadata_output.open("xb") as handle:
                handle.write(document)
        entities = parse_metadata(document)
        report.update(status="available", entityCount=len(entities),
                      entities=[asdict(entity) for entity in entities])
    except OneCError as error:
        report.update(status="blocked", reason=error.code)
        if error.code == "no_published_objects":
            report["entityCount"] = 0
        if error.status_code is not None:
            report["httpStatus"] = error.status_code
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.getenv("YUKSALISH_ONEC_BASE_URL"))
    parser.add_argument("--username", default=os.getenv("YUKSALISH_ONEC_USERNAME"))
    parser.add_argument("--anonymous", action="store_true")
    parser.add_argument("--empty-password", action="store_true",
                        help="Explicitly allow a blank password for this diagnostic only")
    parser.add_argument("--output", type=Path, help="Private report path outside tracked sources")
    parser.add_argument("--metadata-output", type=Path, help="Private copy of XML metadata only")
    args = parser.parse_args()
    if not args.base_url or (not args.anonymous and not args.username):
        parser.error("Provide --base-url and either --username or --anonymous")
    if args.anonymous and (args.username or args.empty_password):
        parser.error("Anonymous mode cannot include credentials")
    password = "" if args.anonymous or args.empty_password else os.getenv("YUKSALISH_ONEC_PASSWORD")
    if password is None:
        try:
            password = getpass.getpass("1C password (not saved): ")
        except EOFError:
            parser.error("Password entry unavailable; configure the server secret explicitly")
    try:
        connection = OneCConnection(args.base_url, args.username, SecretStr(password))
        report = asyncio.run(preflight(connection, args.metadata_output))
    except OneCError as error:
        report = {"status": "blocked", "reason": error.code}
    except OSError:
        report = {"status": "blocked", "reason": "report_write_failed"}
    if args.output:
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            # Refuse to overwrite an earlier diagnostic or any other local file.
            with args.output.open("x", encoding="utf-8") as handle:
                json.dump(report, handle, ensure_ascii=False, indent=2)
        except OSError:
            report = {"status": "blocked", "reason": "report_write_failed"}
    summary = {key: value for key, value in report.items() if key != "entities"}
    print(json.dumps(summary, ensure_ascii=True))
    return 0 if report["status"] == "available" else 2


if __name__ == "__main__":
    raise SystemExit(main())
