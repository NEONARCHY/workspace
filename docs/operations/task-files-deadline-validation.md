# Task files and deadline display — local handoff

Branch: `fix/task-attachments-deadline`, based on `origin/main` a4a3ec9.
Other local calendar/theme packages remain in their separate worktrees unchanged.

Implemented task-only attachment deletion with uploader/admin checks on the API,
confirmation and failed-request retention in the UI, metadata revocation with
private object retention and audit, and timezone-correct deadline labels.
There was no count cap to raise in the current task upload/bootstrap paths;
multi-select/continued batches are documented and a 50-file regression is added.
Per-file size limits are unchanged. No migration is needed. API must be updated
before using the new client deletion action; installed clients/office API were
not updated. No real user data was deleted.

Validation commands:

```powershell
pnpm --filter @yuksalish/desktop test src/renderer/AttachmentDeletion.test.tsx src/renderer/AttachmentPanel.test.tsx src/renderer/TaskDeadlines.test.tsx src/renderer/task-deadline.test.ts src/renderer/workspace-api.test.ts src/renderer/ConfirmActionDialog.test.tsx --maxWorkers=2
pnpm --filter @yuksalish/desktop typecheck
pnpm --filter @yuksalish/desktop lint
pnpm --filter @yuksalish/desktop build:renderer
pnpm --filter @yuksalish/desktop exec tsc -p qa/tsconfig.mobile-browser.json --noEmit
ruff check apps/api/src/yuksalish_api/repository.py apps/api/src/yuksalish_api/routers/workspace.py tests/python/test_task_attachment_delete.py
pnpm check:release-notes
pnpm test:workflow
git diff --check
```

31 targeted renderer tests passed, including forbidden deletion propagation,
server-error retention, confirmation and 50-file batches. Browser QA uses only
synthetic records at `/qa/mobile-secondary.html?theme=light&attachments=1`:
select `tasks`, open the first task, delete a synthetic attachment. The source
sets a deliberately stale 13:00 label and exact local 18:00 timestamp; the card
correctly shows 18:00. Successful deletion preserves the card and returns focus
to the attachments heading. Screenshots: `tmp/task-attachment-proof/`.

Remaining gate before publication: run Python tests in an approved development
environment with project dependencies. The available Python had no pytest;
the attempted local `.venv` executable was blocked by the configured command
allowlist, which was not modified or bypassed. Python syntax compilation and
Ruff passed, but **backend tests, PostgreSQL integration and mypy are unverified**.
New `tests/python/test_task_attachment_delete.py` contains eight permission,
identity/owner and timezone cases. Also run the existing
`tests/python/test_task_deadline_requests_postgres.py` against a separate test DB.
Never point it at the office database. No push/PR/merge was performed.
