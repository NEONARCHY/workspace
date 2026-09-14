# Soft Spatial Workspace

Renderer migration, desktop 0.29.0, September 2026. Existing React / Fluent / Electron stack, Gilroy, navy #293A55 and turquoise #0091A8. API remains 0.23.0 / migration 0024. No changes to backend security or business rules.

## Reference audit

The three attached briefs are identical. Video reviewed as a full 2fps storyboard and an 8fps interaction sequence: owner/team selection expands within one object; avatar lifts from the team cluster into a workflow stage; the source and neighbouring stages remain recognisable. Local reference frames are QA artifacts, not shipped product assets.

## Composition map

- Shell: floating labelled navigation island, canvas header, command entry, compact identity and connection inspector.
- Objects: shared pointer/keyboard drag overlay, source placeholder, eligible lanes, explicit server-confirmed actions. Dragging never substitutes for approval or a motivated rejection.
- Tasks/projects/payments/trips: spatial stage lanes and tactile cards, contained scrolling, contextual inspectors.
- Task composer: elevated bounded object, essential fields first, secondary rules progressively disclosed, final explicit creation action.
- People picker: searchable contextual directory with avatars; selection updates the preview without creating a task. Only supplied, accessible people are shown.
- People/tasks: calm full-width table surfaces, comfortable avatar-first rows, selection/action context.
- Overview/efficiency: narrative metrics on the canvas, contextual methodology, restrained static light.
- Calendar: useful day grid and contextual inspector; existing date validation unchanged.
- Notifications/feed/chat/settings: shared surface, typography, action, focus and layer grammar; existing controls retained.

## Motion contract

120–180ms controls; 180–260ms context; 260–420ms layer changes. Transform/opacity only for continuous movement. No animated blur, full-screen ambient animation, native browser drag ghosts, synthetic numbers or decorative looping motion. Reduced-motion removes travel. Text is never scaled in normal screen transitions.

## Verification

### Completed

- Full renderer suite: **156 tests passed across 20 files**, run with four workers. Additional focused regression after context/focus polish: 33 tests passed; board confirmation/rejection/retry regression: 6 tests passed. Earlier unrestricted parallel run exposed timing-sensitive existing UI tests; no production permission or mutation logic was weakened to satisfy them.
- ESLint, TypeScript, production renderer/main/preload build passed.
- Browser UI against the local API: 1440×960, 1024×768, 640×480. Inspected shell, messenger, task list/board/overview/composer/efficiency, project board/inspector, payment and trip boards, workflow editor, calendar, people, departments, module permissions, notifications, feed and account settings.
- Verified real keyboard lift, eligible lane feedback, animated preview, Escape returning the source; pointer scenarios in tests cover successful confirmation, rejection, retry and permission-denied cases. Tests retain actual dnd-kit logic; only jsdom geometry is supplied.
- Verified editable draft preview, owner search, disclosure retaining form values, contextual notification focus/return, bounded modal footer and contained vertical/horizontal scrolling.
- Corrected conflicts found visually: old hero text contrast, compressed approval cards, empty permanent inspectors, department dialog width, narrow-window board height, efficiency commandbar overflow and messenger list width.
- Browser developer logs returned no error/warning entries at the final inspection.

Repeatable checks: `pnpm --filter @yuksalish/desktop lint`, `pnpm --filter @yuksalish/desktop typecheck`, `pnpm --filter @yuksalish/desktop test --maxWorkers=4`, `pnpm --filter @yuksalish/desktop dist:win`.

### Windows artifact

`apps/desktop/release/Yuksalish-Workspace-Setup-0.29.0.exe` — 145,182,613 bytes (138.5 MiB), NSIS x64, built 2026-09-09. Authenticode status: `NotSigned`. SHA-256: `0FD761D9901C983F63D148799BC265B020E3B597FD9FE72A85BF6175D7BD08D5`. Packaging succeeded; installation and native execution are not included in the verified results below.

### Boundaries

- Dedicated Electron test launch was denied by the host execution policy. The installed application was not replaced or stopped. A packaged installer is produced separately; native titlebar/maximize/restore behavior of this build still needs an allowed native launch. Existing titlebar/sandbox/IPC behavior is unchanged apart from the displayed build version.
- Reduced-motion is respected by CSS, sortable transitions and imperative board animations; a hardware frame-time profile was not captured. **60 fps is a target, not an unmeasured guarantee**, particularly while the previously reported GPU/driver issue remains outside this renderer change.
- Workflow cards preserve backend stage order. This does not introduce a new persisted arbitrary ranking of business records inside one stage. Personal menu and pinned-chat ordering still use their existing persistence.
- No real approvals, payments, department permissions or employee lifecycle states were changed during visual QA. Test composer selections were cancelled without submission.
- Known build warnings: existing large renderer bundle, missing third-party Tabster sourcemaps in tests, no application code-signing certificate.
