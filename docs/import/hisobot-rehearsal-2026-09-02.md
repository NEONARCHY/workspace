# Hisobot import rehearsal — 2026-09-02

## Outcome

The confirmed Hisobot snapshot was imported into a clean isolated Docker Compose
environment twice. The first run imported every expected source item and uploaded every
archive file. The second run reused the same immutable import run and created no duplicates.

This rehearsal is evidence for the importer contract, not authorization for production
cutover. The working Telegram bot was restarted after the confirmed snapshot was copied,
so cutover still requires a new stopped-write snapshot and the same verification sequence.

## Environment

- Compose project: `yuksalish-import-qa`
- Docker Engine: 29.4.0
- PostgreSQL: 17 Alpine
- MinIO: `RELEASE.2025-09-07T16-13-09Z`
- Source mount: read-only (`/snapshot:ro`)
- Source system: `yuksalish_hisobot_sqlite`
- Mapping version: `1.0.0`

Docker Desktop initially failed to start because its data VHDX remained attached after an
I/O error. A full WSL shutdown detached the VHDX and restored the engine without a factory
reset or removal of unrelated Docker data.

## Source evidence

| Check | Value |
|---|---|
| SQLite integrity | `ok` |
| SQLite bytes | `1,114,112` |
| SQLite SHA-256 | `0cc6bae63e7df9060af9a5d8c147e44ca6796eccaf6aff2edf8e8aedadec8eb7` |
| Schema SHA-256 | `1fe17ffedae2cdfffa395d34ddfd30fb1ff774d47e74006ec996867ed8b9c15f` |
| Archive files | `54` |
| Archive manifest SHA-256 | `d84985dd56a826ed8a05c24fe4e7773b68a15d871d12a760df4b035770aec61d` |
| Package file references | `47` resolved, `0` missing, `0` ambiguous |
| Snapshot fingerprint | `d69f11e742fa26e2b5d39b3387707fe1cc9d1d89bade631f0f8a77ed2c1cc2a7` |

The same inspection was repeated after both imports. Every value above remained unchanged.

## Import runs

| Attempt | Run ID | Reused | Status | Ledger items | Quarantine |
|---|---|---:|---|---:|---:|
| First | `d3f64c05-14b3-4223-a111-8a36a4d6bd60` | no | `validated` | 3,963 | 0 |
| Second | `d3f64c05-14b3-4223-a111-8a36a4d6bd60` | yes | `validated` | 3,963 | 0 |

The ledger consists of 3,909 rows from all 18 SQLite tables plus 54 archive registry items.

## PostgreSQL reconciliation

| Target | Rows |
|---|---:|
| `system_import_runs` | 1 |
| `system_import_items` | 3,963 |
| `system_import_quarantine` | 0 |
| `hisobot_reports` | 333 |
| `hisobot_vacations` | 2 |
| `hisobot_summaries` | 39 |
| `hisobot_report_artifacts` | 47 |
| `hisobot_legacy_archive_files` | 54 |
| `hisobot_legacy_user_preferences` | 37 |
| `hisobot_legacy_delivery_states` | 248 |
| `hisobot_legacy_reminder_states` | 2,473 |
| `hisobot_legacy_ui_messages` | 730 |
| `legacy_identity_links` | 83 |

All 3,963 ledger items have status `imported`. The 54 archive records have 54 distinct
source keys and 54 distinct object keys. All archive and report-artifact storage states are
`uploaded`.

## MinIO reconciliation

- Bucket: `workspace-files`
- Objects: 54
- Distinct object keys: 54
- Total bytes: 5,609,204
- Objects with SHA-256 metadata: 54

## Quality gate

`scripts/check.ps1` completed successfully after the rehearsal:

- Ruff: clean
- mypy: clean across 23 source files
- pytest: 24 passed, 1 environment-gated PostgreSQL test skipped
- Python coverage: 86.83% (required: 80%)
- Python dependency audit: no known vulnerabilities
- Desktop Vitest: 2 passed
- ESLint, TypeScript type-check and production build: passed
- pnpm audit: no known vulnerabilities

## Remaining production gates

- Capture a new snapshot while the working bot is stopped and confirm its fingerprint.
- Use production secrets supplied outside Git and production-specific PostgreSQL/MinIO.
- Enable private object storage encryption and complete backup/restore validation.
- Repeat this exact two-run reconciliation against the final cutover snapshot.
