# Emoji/theme polish — local branch, TEST web only

- Worktree: `tmp/emoji-theme-polish`, branch `fix/emoji-theme-polish`.
- Baseline: deployed `302e3a38722dffdf10d78c2a4d82192ccf64c92b`.
  Deliberately excludes later main changes and the separately pending local calendar,
  task proposals and deadline UX. Do not deploy either of those dirty worktrees.
- User authorized local changes and immediate TEST web update, explicitly no push.
  No PR, merge, API update, migration, office-server or installed EXE change.

## Changes

- Fixed 352×440 picker (bounded by viewport), stable category/search geometry,
  common search styling and square 36×36 close button.
- Context stack/strip/menu share 210 px; seven quick emoji are 20 px.
- Session-wide static decoded thumbnail cache; existing bounded animated-byte
  warmer remains. No hidden animated decoders, no per-frame React work.
- All 115 available Noto animations regenerated without dropping source frames.
  Native sources generally use 30 ms steps (not 60 fps); versioned animation URL
  invalidates previous month-long HTTP cache. Five static fallbacks unchanged.
- Theme reveal: 680 ms, quicker initial response and longer deceleration;
  temporary compositor hint only on the native snapshot. Existing interruption,
  reduced motion, hidden document and error fallback retained.

## Verification

- 43 focused renderer tests passed (picker, emoji playback, assets, warmup,
  theme and context menu); TypeScript, ESLint, release notes and 15 workflow tests passed.
- Additional MessengerView/theme-geometry regression: 104 tests passed (147 total).
- Docker production web build passed; TEST web became healthy. HTTPS root and API
  readiness passed; deployed version 2.0.039, build ID below, built at
  2026-10-16T12:59:24.705Z. This is a provisional local release, not merged main.
- `scripts/emoji-theme-polish-smoke.cjs` uses real components and styles on a
  synthetic read-only fixture. Both themes, category/search geometry, square
  close, equal strip/menu widths, 1024×768 and 390×600, reduced motion passed.
- Edge headless synthetic measurement: warm picker 60 fps; theme wave 59 fps;
  p95 16.8 ms, no frames over 50 ms. Reopening transferred zero emoji bytes.
  These are local fixture measurements, not a guarantee for every GPU, the full
  populated app, or packaged Electron.
- Evidence: ignored `tmp/emoji-theme-polish-qa/report.json` and screenshots.

## Deployment / continuation

TEST: `https://192.168.0.127:8443/`, project `yuksalish-localtest`.
Only build/recreate web with explicit environment and regenerated release-note order.
Build ID: `localtest-20261016-emoji-theme-polish`.
Deployed source commit: `fb06f52dff14351d51aa6a812315c95a0e34d160`.
Pre-change web image: `sha256:a2a66453cacccd2cde653ceab7f96a560c788a21a14dfee92cb95ce1345b482d`.
Verified deployed version/buildId, HTTPS root, API readiness and unchanged other containers.
The pending note's version is provisional until an authorized merge; never present it as main.

Next task: obtain owner feedback on TEST. Keep branch local until explicit push/merge
authorization. If genuine 60 fps artwork is requested, use suitable higher-rate/vector
source animations; do not duplicate frames and call that 60 fps.
