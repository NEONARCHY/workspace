# Circular selection and first-entry latency — 19 October 2026

Source branch: `fix/messenger-selection`, based on fresh origin/main 2fccd82c
plus the existing main-based messenger/search continuation. TEST must instead
continue bcd0ae2a on `fix/notification-search-surface-test`; apply only the scoped
selection commit, never deploy this main-based API/schema to TEST.

Before: selection state invalidated the complete `messageRows` memo, rebuilding
rich content for every message. Focusing the newly mounted checkbox also invoked
the reaction focus handler, invalidating history a second time.
After: a small context-consuming row shell owns selection and its native checkbox.
Stable rich children are reused. One viewport observer limits marks to visible
rows plus an 80px buffer; offscreen history is not rebuilt or removed. Selection
IDs live separately and survive scrolling. Observer disconnects on unmount.
Selection focus/pointer events do not invoke
reaction hover/focus handlers; the pending hover timer is cleared on entry.
Right-side absolute marks share one rail for incoming/outgoing rows, with a stable
36px reserved space so entry does not rewrap history. The small toolbar stays
mounted but hidden/inaccessible until selection, avoiding first-use style setup.
Native checkbox semantics, circle/check shape, keyboard operation,
focus and forced colours remain explicit. No API or migration changes.

Checks: shell regression uses 200 rich children and asserts no extra renders for
entry/toggle/focus/cancel. Existing forwarding UI covers selection persistence,
ordered retry without duplicates plus circle geometry/right alignment in both
themes at 1440/1024/640/320. Synthetic 502-message browser test measures first entry
through two animation frames and retains text DOM; its 1s ceiling is a regression
guard on shared development hosts, not a hardware-independent FPS guarantee.
No real messages are sent by these fixtures; installed Electron is not verified.

Validation: 104 conversation/selection unit tests passed; the two selection tests
were rerun after final shell/observer changes. Final desktop typecheck and
changed-source lint passed; release notes and 15 workflow tests passed.
Production-mode isolated fixture: 502 messages, first selection to second animation
frame 224ms on this host (233ms previous run). Only visible marks are mounted;
scrolling to older messages and back preserves selection. This does not measure
the user's browser/device or prove an absence of all frame stalls.

Release only web on TEST after checks. Keep API schema0102 and all non-web
containers unchanged. Record version/readiness and rollback image after release.

## Delivered TEST

Web 2.0.058 / `localtest-20261019-selection-fbb39c27`, built
2026-10-19T08:42:51.214Z. Root, version and API readiness returned 200 at
https://192.168.0.127:8443/. Only web was recreated (12700e6e83d1); all nine
non-web IDs unchanged. Schema 0102_merge_leave_task; users=3/tasks=1/messages=133.
Rollback image: `yuksalish-localtest-web:pre-selection-20261019` (2.0.057).
Compatibility typecheck, both new unit regressions and all eight forwarding UI
cases passed again before replacement. No API/worker/office/EXE update, real
messages, push, PR or CI run. Main-based scoped change is cf37ea03; keep the TEST
compatibility branch out of main. Scroll-rail WIP remains separate and undeployed.
