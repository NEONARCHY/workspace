# Mini messenger composer buttons — 19 October 2026

Source branch: `fix/messenger-composer-buttons`, continuing556dfdab; freshly fetched
origin/main remains2fccd82c. The five bottom Fluent buttons stretch into equal grid
columns with existing6px gaps and10px outer padding. Send button, field, desktop
composer, control names, disabled/focus states and action behavior are unchanged.
Only scoped CSS sizing rules; no new production elements, dependencies, API/schema
or data writes. The fixture enables the existing assistant permission to cover its
fifth, nested tool button too; no rewrite request is sent.

The floating messenger browser suite measures equal widths, both outer insets and
all gaps, alongside existing file/draft/navigation/drag/reduced-motion flows in
light/dark at1440/1024/640/390px.
TypeScript, changed-fixture ESLint, release-note validation and15 workflow tests
passed. The light mini screenshot was visually inspected; no real sends occur.

For TEST continue compatibility13dc9467, cherry-pick only this patch, and update
web only. Prior TEST2.0.063; retain rollback, verify root/version/API readiness and
unchanged non-web container IDs. Never merge compatibility into main or update
office server/EXE as part of this task.

## Delivered TEST

Web2.0.064 / `localtest-20261019-composer-buttons-7e2ab381`, built
2026-10-19T09:25:44.590Z from compatibility6e97c52d (source7e2ab381).
Root/version/API readiness returned200. Only web changed (c553f940e393);
all nine non-web IDs unchanged. Schema0102_merge_leave_task; users3/tasks1/messages133.
Rollback: `yuksalish-localtest-web:pre-composer-buttons-20261019` (2.0.063).
All8 floating browser cases passed, including actual equal-width/full-row
measurements, preserved drafts/files/navigation and previous back-arrow checks.
Vite5178 helper stopped. No office/EXE update, push, PR, merge or CI.
