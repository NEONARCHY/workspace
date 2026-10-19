# Messenger forwarding and compact task UI — 2026-10-19

## Scope

- Forward message attachment bytes into independent private objects, with fresh
  attachment IDs/unique keys, original metadata/caption and existing provenance.
- Preserve source/history and target-send/upload permissions, UUID idempotency,
  cleanup after storage failures. No schema migration.
- Multi-select normal messages in history order; batch forwarding, cancellation
  and retry without re-sending confirmed successes. Target avatars 40 px/dividers.
- Remove messenger hero, retain create-group next to search.
- Task proposals: equal 14 px top/bottom gaps, real satin border in both themes.
- Team flow total: content-sized label/count, no clipping, wraps below heading
  on narrow containers.

## Source and TEST boundary

Integration branch: `fix/messenger-forward-selection`, based on origin/main.
TEST compatibility baseline: `fix/task-list-avatar-size-test` at `5d339fd6`.
Do not deploy the full current main to TEST: it contains unrelated schema changes.
Compatibility build must keep TEST schema `0102_merge_leave_task` and existing
prior chat UI packages. Only API and web replacement was approved. No office
server, worker/scheduler recreation, push or PR was requested for this package.

## Validation / reproduction

- Desktop focused Vitest JSON report: `tmp/messenger-forward-final-tests.json`.
- `scripts/messenger-forward-smoke.cjs`: both themes, 1440/1024/640; selection,
  target avatars/dividers, cancellation, partial failure and same-UUID retry.
- `scripts/task-proposals-spacing-smoke.cjs`: both themes, 1652/1024/640;
  collapsed/open geometry and forced-colors border.
- `scripts/team-flow-total-smoke.cjs`: both themes, 1652/1024/640/360;
  188 and 99999 stay inside padding.
- Browser scripts use Vite port 5178 and PLAYWRIGHT_MODULE, synthetic data only.
- `scripts/test-forwarding-local.py`: guarded isolated QA Postgres only, port
  55439; use workspace_qa for main or fresh workspace_qa_compat for old TEST line.
  Never point this runner at the TEST business database.
- `scripts/qa-forward-storage.py`: MinIO copy/delete check with only two unique
  disposable objects, no messages or database writes.

Release and final deployment evidence are appended after actual verification.
Real multi-user delivery and installed Electron remain separate manual checks.

Main-based validation passed: 123 focused desktop tests, desktop typecheck/lint,
5 forwarding Python regressions on isolated Postgres, scoped Ruff/Mypy, 15 workflow
tests, release-note validation and PR overlap check (no shared changed files).
Browser scenarios passed: 6 messenger, 6 proposals, 8 flow-total theme/viewport cases.
Screenshots were visually inspected; no 60 FPS claim or real-user delivery claim.

TEST before update: 2.0.053, build localtest-20261019-task-list-avatars-34px.
Schema 0102_merge_leave_task; users=3, tasks=1, messages=133.
Backup: ignored tmp/pre-forward-20261019.dump (445460 bytes).
Rollback images tagged yuksalish-localtest-api:pre-forward-20261019 and
yuksalish-localtest-web:pre-forward-20261019.
