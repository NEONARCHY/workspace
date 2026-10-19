# Mini messenger back arrow — 19 October 2026

Source: `fix/messenger-back-arrow`, continuing paint-selection04d9bec6;
origin/main2fccd82c freshly checked. Only renderer presentation changes.

The mini header back control retains its accessible name and click/keyboard
behavior, but has no background, satin border or shadow, including hover/active.
Its40px hit area aligns to the40px avatar and centers the existing Fluent chevron.
No API, permission, history, selection, draft or navigation behavior changes.

The existing floating messenger smoke suite now checks actual icon/avatar centers,
transparent hover background and no gradient/shadow in both themes/four widths.
Five focused unit tests, TypeScript, changed-source ESLint, release notes and15
workflow tests passed. Light/dark mini screenshots visually inspected.
For TEST, continue compatibility36490703; cherry-pick only this scoped patch,
rebuild/recreate web only and verify version/root/readiness and unchanged other
containers. Keep office server, API, data and EXE untouched. Prior TEST2.0.062.
Do not merge the compatibility branch into main.

## Delivered TEST

Web2.0.063 / `localtest-20261019-back-arrow-1222ec35`, built
2026-10-19T09:20:27.588Z from compatibility1222ec35 (source aebc3c0f).
Root/version/API readiness returned200. Only web changed (7c17e77eaec3);
all nine other container IDs unchanged. Schema0102_merge_leave_task;
users3/tasks1/messages133 unchanged. Rollback: `yuksalish-localtest-web:pre-back-arrow-20261019`.
All8 floating messenger theme/viewport cases passed, including icon alignment,
transparent hover, navigation, drafts/files and reduced motion. No real messages
sent, office/EXE update, push, PR, merge or CI. Vite5178 helper stopped.
