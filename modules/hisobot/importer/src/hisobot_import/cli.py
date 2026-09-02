from __future__ import annotations

import argparse
import asyncio
import json
from collections.abc import Sequence
from pathlib import Path

from yuksalish_api.settings import get_settings

from .mapping import load_mapping, validate_mapping
from .source import inspect_snapshot
from .storage import MinioObjectStore
from .writer import apply_snapshot


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verified Yuksalish Hisobot import tooling")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_command = subparsers.add_parser("inspect", help="Inspect a SQLite snapshot")
    inspect_command.add_argument("--database", type=Path, required=True)
    inspect_command.add_argument("--archive", type=Path)

    mapping_command = subparsers.add_parser("validate-mapping", help="Validate mapping coverage")
    mapping_command.add_argument("--mapping", type=Path)

    apply_command = subparsers.add_parser(
        "apply", help="Apply an immutable snapshot to PostgreSQL"
    )
    apply_command.add_argument("--database", type=Path, required=True)
    apply_command.add_argument("--archive", type=Path, required=True)
    apply_command.add_argument("--mapping", type=Path)
    apply_command.add_argument("--confirm-fingerprint", required=True)
    apply_command.add_argument(
        "--upload-files",
        action="store_true",
        help="Upload verified archive files to the configured private MinIO bucket",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "inspect":
        inspection = inspect_snapshot(args.database, args.archive)
        print(json.dumps(inspection, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if inspection["database"]["integrity"] == "ok" else 2
    if args.command == "validate-mapping":
        mapping = load_mapping(args.mapping)
        issues = validate_mapping(mapping)
        print(json.dumps({"valid": not issues, "issues": issues}, ensure_ascii=False, indent=2))
        return 0 if not issues else 2

    settings = get_settings()
    object_store = None
    if args.upload_files:
        minio = MinioObjectStore(
            settings.s3_endpoint,
            settings.s3_access_key,
            settings.s3_secret_key.get_secret_value(),
            settings.s3_bucket,
            secure=settings.s3_secure,
        )
        minio.ensure_bucket()
        object_store = minio
    import_result = asyncio.run(
        apply_snapshot(
            database_path=args.database,
            archive_root=args.archive,
            database_url=settings.database_url,
            expected_fingerprint=args.confirm_fingerprint,
            mapping_path=args.mapping,
            object_store=object_store,
        )
    )
    print(json.dumps(import_result.to_dict(), ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
