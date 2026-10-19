# Launcher visibility — 19 October 2026

Source branch: `fix/messenger-launcher-visibility`, continuing the main-based
messenger package at17572a55 (fresh main2fccd82c already integrated).
The launcher is now natively hidden for `miniOpen || fullPage`: no overlay,
accessible button or Tab target on the full Messenger section. Other sections
restore the same draggable launcher; the shared MessengerView/draft remain mounted.

Regression coverage: direct full-page entry, mini-to-full handoff, absence of the
launcher, leaving the section and reopening mini with the retained draft. Browser
page-canvas and full messenger flows cover both themes/four widths. No API/schema,
office-server, installer, real messages or access rules change.

For TEST continue `fix/messenger-page-canvas-test` d6ab9005, cherry-picking only this
scoped change. Update web only at https://192.168.0.127:8443/; keep schema0102 and
non-web containers unchanged, retain rollback and verify root/version/readiness.
Before this change TEST is2.0.060 / localtest-20261019-messenger-canvas-45c3dbc2.
Do not merge the TEST compatibility branch into main.

## Delivered TEST

Web2.0.061 / `localtest-20261019-launcher-visibility-d1c85c0b`, built
2026-10-19T09:01:12.107Z from compatibility4cb07a00 (source patchd1c85c0b).
Root/version/API readiness returned200. Only web changed (bcff7254e871);
all nine non-web IDs unchanged. Schema0102_merge_leave_task; users3/tasks1/messages133.
Rollback: `yuksalish-localtest-web:pre-launcher-visibility-20261019` (2.0.060).
5 unit tests, typecheck, changed-source lint, release notes and15 workflow tests
passed. Both browser matrices passed in light/dark at four widths; full absence,
navigation return and retained files/draft verified. Compatibility canvas/visibility
matrix passed again before release. No push/PR/CI or office/EXE update.
