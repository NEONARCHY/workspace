# Task proposals — local-only handoff, 16 October 2026

Publication update: the owner subsequently authorized pushing and merging all
pending work from this chat and updating TEST, including API/schema. The original
local-only boundary below is historical. Integrate via the combined release PR;
office deployment and installed-client rollout remain excluded.

## Owner boundary

Subsequent local task work also exists in this checkout: see
[task-deadline-ux-local-handoff.md](task-deadline-ux-local-handoff.md).
It adds the deadline decision inbox/filter and work-first card hierarchy.
Do not publish either package without new authorization or silently combine
them with the separate calendar changes.

The owner explicitly selected «Пока только локально» for this feature.
Do not push, create/merge a PR, deploy TEST, apply its migration to TEST, rebuild
the installed EXE or touch the office server without a new request.
Local branch: `feature/task-proposals`, based on `302e3a38` (merged messenger fix).
Working files are local and uncommitted. This checkout happens to be named
`tmp/messenger-sync-release`; use Git branch/state, not that directory name,
to identify the current work.

Calendar changes remain in the separate sibling `workspace-pending-release`
on `fix/calendar-space-and-day-scroll`, also local-only. Do not mix them in.

## Implemented

- Standalone TaskComposer selects another author and fixes requester as assignee.
  Entire form, co-assignees, observers, checklist, dependencies and recurrence
  are sent only as a proposal. Ordinary direct creation remains unchanged.
- TaskProposals lists only the two parties' proposals, opens from a notification,
  displays the full immutable draft, supports personal consent, motivated rejection
  and requester withdrawal. Older reads cannot overwrite confirmed decisions.
- Server validates module access and active people; only the named author can
  consent, including when the caller is an administrator. Approval revalidates
  dates/links/participants, row-locks and atomically creates one task+chat.
  Identical retries and decisions are idempotent. No task/efficiency event exists
  before approval. Creator and approver remain audited. Recurrence retains
  the confirmed author.
- Additive migration `0101_task_proposals` creates a separate table.
  Existing task records and lifecycle are not rewritten. API/schema must precede
  the new client whenever deployment is later authorized.

## Checks

- Full Python/PostgreSQL suite: **1073 passed, 5 skipped**, existing cartesian-query
  warning in assistant-birthdays test. No coverage threshold or assertion weakened.
- Focused task-proposal/task-plan suite: 13 passed, including real HTTP concurrent
  approval and rollback after injected task/chat creation failure.
- Ruff, strict mypy (172 source files), TypeScript, ESLint, release-note validation,
  15 workflow tests and production web build passed.
- Renderer 5-file regression run: 93 passed, one source-message notice timing
  failure; that unchanged assertion passed in a focused rerun. No assertion or
  timeout was weakened. After the final self-assignee/department guard, both
  TaskProposals and TaskComposer files passed together (16 tests).
- Final production web build, TypeScript and ESLint passed after the UI guard.
- TEST was read-only checked and remains 2.0.038, buildId
  `localtest-20261016-messenger-sync`, Alembic0100. No deployment occurred.
- Full live browser/Electron and two-person interactive UX have not been verified.

QA used the separate `yuksalish-task-history-qa` Postgres container and new
`yuksalish_test_task_proposals_20261016` database, not TEST. Container stopped;
data retained. Ignored helper `tmp/run-sync-qa.ps1` has the exact isolated commands
and reads credentials internally; never print or commit its environment.
Use a new isolated database for a future full baseline suite: the completed full
suite leaves import fixtures behind, so blindly rerunning against this database
can produce known duplicate-fixture failures. Do not reset or drop TEST data.

## Exact next task if publication is requested

1. Read Git status and this boundary first. Keep calendar and other people's work.
2. Fetch fresh main and integrate normally in this feature branch. Recheck Alembic
   heads: other pending work may introduce a migration after 0100. Never rewrite
   a migration already applied to a shared server; add a merge revision if needed.
3. Re-run `pnpm check:pr-overlaps`. Last advisory: PR202 overlaps TaskComposer and
   TasksView; PR200 overlaps access_control, main, tables, App.test, workspace-api
   and shared contracts. Review actual changed lines and reconcile meaningfully.
   These are references, not authorization to merge or message those tasks.
4. Repeat affected checks, update own pending note, commit only this feature,
   push its branch and create a PR. CI/review precede any separately authorized merge.
5. For an authorized TEST rollout: evaluate all newly merged migrations, back up
   TEST, prepare release-note ordering from the exact verified Git revision,
   build/update API+web only, then verify actual version/buildId, readiness,
   Alembic head and a safe two-user proposal/consent flow. Never infer office
   deployment or installed-client updates from a Git push.
