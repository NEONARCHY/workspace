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
