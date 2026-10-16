# Detail layout polish — local + TEST web only

## Scope / authority

Owner requested eight screenshot-based refinements. Continuing the explicit
local/no-push mode and TEST-web-only release. No API/database/office-server/EXE changes.
Branch: `fix/detail-layout-polish`, worktree: `tmp/emoji-theme-polish`.
Base: `378e295d` (previous local emoji/theme TEST package), not the unrelated
dirty `feature/task-proposals` or local-only calendar checkout.

## Implemented

1. Task history animates down/up over 260 ms, with measured async content changes.
   Observer measures content, not animated wrapper: no per-frame React updates.
   Hidden content is inert/aria-hidden; reduced motion/forced colours disable motion.
2. Task participant scope fills the whole form width with equal compact segments.
3. Recurrence fields use equal control height, responsive card-width columns and
   a separate compact action row; no stretched save/cancel buttons.
4. Staff-report dates and scope have labels/consistent widths; full-width search
   row retains shared search morph without pushing refresh beyond the row.
5. Map back button follows the place count. Unresolved trips are inside the
   right sidebar, above the map at compact widths, never in a bottom-only section.
   Counter styling applies only to direct spans, not the relocated button's icon.
6. Feed pin/delete are square 36×36 surfaces with existing semantics and permissions.

## Checks

- 26 focused renderer tests passed: history, trip map, Hisobot, Feed; TypeScript
  and ESLint passed. Release-note validation and 15 workflow tests passed.
- `scripts/detail-layout-polish-smoke.cjs`: real components + complete main CSS
  ordering, synthetic API reads only, writes blocked. Dark/light, animated history
  (18–20 intermediate height steps), equal-width scope, recurrence controls 40 px,
  actions 36 px, aligned reports, map sidebar/back placement, square Feed controls.
  1024/720/390 widths: no targeted horizontal overflow; compact sidebar above map.
  Reduced motion and forced-colour transition checks passed.
- Evidence in ignored `tmp/detail-layout-polish-qa/`: screenshots + report.json.
  These checks do not represent native installed Electron or live-account delivery.

## Release

Only rebuild/recreate `web` in `yuksalish-localtest`; regenerate release-note
order from the final source commit first. Build ID:
`localtest-20261016-detail-layout-polish`.
TEST: `https://192.168.0.127:8443/`.
Deployed and verified: version `2.0.040`, build ID above, built at
`2026-10-16T13:14:22.615Z`, source `fa123faf9d86d5301ea0c24b1c1b7824fe2e3bf9`.
Docker production build passed; web healthy, HTTPS root accessible, API ready.
Only web container was recreated; API/database/other service uptimes unchanged.
This is a provisional local TEST release, not a merged/pushed shared main release.
Temporary QA Vite process on 5178 was stopped after final successful smoke.
Rollback web image before this package:
`sha256:0fbb34243b8d679061d5f8da61e10dfb44c35aa144e90044b0e65b2e9dac75cf`.

Next task: confirm owner feedback on the eight refinements. Keep local commits
unpublished until explicit push/merge authorization. Other pending calendar,
deadline-request and task-proposal changes remain in their original worktrees
and are not implicitly approved for release by this UI request.
