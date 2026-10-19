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
