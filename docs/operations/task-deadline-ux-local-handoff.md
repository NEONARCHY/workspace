# Deadline decision inbox and task-card hierarchy — local handoff

Publication update: owner now authorizes push/merge of all this chat's pending
packages and complete TEST rollout, including proposals/calendar. Previous local
restrictions below describe the earlier checkpoint, not the current authorization.

## Scope and release boundary

Implemented locally on 16 October 2026 in the existing dirty
`feature/task-proposals` checkout (`tmp/messenger-sync-release`).
The previous self-proposed-task package is still uncommitted/local and preserved;
this follow-up builds on those working files. No push, PR, merge or TEST deployment
is authorized or performed for this follow-up. Calendar remains in the separate
`workspace-pending-release` checkout and is not included.

## Behaviour

- A task executor's deadline request persists a separate system/task notification
  for the actual task author in the same transaction as the existing chat message.
  It includes requester name, task title, old/proposed dates and reason.
- Bootstrap materialises older pending requests using a stable event key. Read
  and desktop-delivery acknowledgements are not reset. Decisions resolve the
  action; stale/superseded/closed requests are reconciled. Resolved notices do not
  replay as native banners. Existing platform permissions/preferences still apply.
- The author-specific «Перенос срока» filter combines with search, role and plan.
  Compact badges appear in the list and Kanban. The pending decision is directly
  under the task heading and uses the existing protected approval/refusal endpoint.
- Results and files precede lifecycle and configuration content in actual DOM
  order. Team, plan links, subtasks, checklist, dependencies, recurrence and
  efficiency controls are collapsed under «Команда и настройки задачи».
  Disclosure preserves drafts. Existing dark recessed surfaces extend into it.

No additional migration is needed for this deadline follow-up. The separate
proposal feature still has its own 0101 migration; do not deploy mixed working
files while assuming the whole local package is migration-free.

## Validation

- Full Python/PostgreSQL suite on fresh isolated database:
  1073 passed, 5 skipped; one existing assistant-birthdays cartesian-query warning.
- Focused deadline/proposal API tests: 8 passed; includes immediate dedicated
  notification, author-only recipient, stable bootstrap identity, approval,
  refusal and supersession, plus earlier proposal permission/atomicity coverage.
- Final 4-file targeted renderer run: 32 passed (deadline decisions/filter/card
  ordering, task proposals and notification delivery).
- Broader App/Messenger/deadline run: 170 passed, one old tooltip test initially
  needed to open the newly collapsed settings first. It was updated to follow
  the real UI. Focused rerun passed. It now waits for the lazy Tasks list
  (up to 10 seconds when run cold) instead of querying before the route loads;
  all tooltip and upload assertions remain unchanged.
- Ruff, strict mypy, TypeScript, ESLint, web build, release notes, workflow checks
  and diff checks passed. Assertions were retained; no quality gate was weakened.
- Native OS banner delivery and live two-user browser/Electron UX were not
  exercised. API payload/route and DOM interaction were tested automatically.

QA database: `yuksalish_test_task_deadline_ux_20261016` in the separate
`yuksalish-task-history-qa` container (stopped, data retained).
Ignored helper `tmp/run-sync-qa.ps1` has the isolated commands, not TEST.
Use a fresh isolated database for future full baseline runs to avoid stale
import-fixture contamination. Never print credentials or reset shared data.

## Exact next step

Review these local changes with the owner. If publication is requested, first
clarify whether to publish deadline UX alone, proposals too, and/or calendar;
they have separate local-only boundaries. Preserve all working files, split
changes deliberately, fetch main, review open-PR overlaps and migration heads,
repeat affected checks, then use the normal PR/green-CI lifecycle.
Do not infer publication or office-server authority from this handoff.
