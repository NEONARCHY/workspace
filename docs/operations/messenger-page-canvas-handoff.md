# Full messenger canvas — 19 October 2026

Source: `fix/messenger-page-canvas`, fresh main2fccd82c plus the existing verified
messenger continuation. Root cause: `page-canvas.css` clears direct app-content
messenger roots, but the persistent messenger now lives in a portal. Its old
workspace-2 root gradient and 4px/20px outer padding remained visible as a square.

Scoped fix: only `.floating-messenger-panel.is-full-page > .messenger-view`
gets transparent background and zero outer padding. Existing pane rounding,
12px gap, internal spacing, wallpaper, scrolling and mini/morph styling remain.
The established <=760px single-pane zero radius is intentionally preserved;
desktop panes retain their existing rounded shape. The shell's outer page gutter
is not changed, nor is the separate unfinished page-scroll-rail package deployed.

Regression coverage: CSS contract and browser geometry in both themes at
1440/1024/640/320. Transparent fill/image, all four zero paddings, panel edges
matching the freed work area, unchanged desktop/compact radii, no root horizontal
overflow and handoff back to mini. The morph/shadow pixel regression passes too.
17 page-canvas/floating unit tests, release notes and 15 workflow tests passed.
No API or schema changes, real-account sends, installed EXE or FPS claim.

For TEST continue `fix/messenger-morph-shadow-test` b8c80a25 and cherry-pick only
this scoped patch; never deploy main API/schema or merge TEST compatibility into
main. Update web only at https://192.168.0.127:8443/, verify root/version/readiness
and unchanged non-web IDs/schema0102; keep the previous web rollback image.
Before this patch TEST is2.0.059 / localtest-20261019-morph-shadow-30fc3568.

## Delivered TEST

Web2.0.060 / `localtest-20261019-messenger-canvas-45c3dbc2`, built
2026-10-19T08:56:06.461Z. Root/version/API readiness returned200.
Only web changed (b3c27f6df0e6); all nine non-web IDs unchanged.
Schema0102_merge_leave_task; users3/tasks1/messages133.
Rollback: `yuksalish-localtest-web:pre-messenger-canvas-20261019` (2.0.059).
Compatibility browser matrix,13 CSS contracts and15 workflow tests passed.
Scoped main-based patch1721db37; TEST patch45c3dbc2. No push/PR/CI/office/EXE update.
