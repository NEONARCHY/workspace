# Message paint selection — 19 October 2026

Source branch: `fix/messenger-paint-selection`, continuing main-based launcher
visibility a24c382a (origin/main2fccd82c). No API/schema changes.

Selection actions now overlay the existing conversation header, retaining its
layout height. Hidden original controls are removed from keyboard navigation.
The history viewport, scroll position and bubble geometry remain unchanged.

Primary mouse drag paints rows using cached vertical bands, including blank
horizontal space next to bubbles. Crossing rows toggles them; lingering in the
same row does not. Returning after leaving a row toggles it again. Fast movement
includes skipped bands in travel order. Edge scrolling uses one animation frame
loop; release/cancel/lost capture/blur/resize/history changes stop it. Touch,
native scrollbar dragging, modifiers, links/buttons and horizontal text selection
retain native behavior. No new dependencies or rich-history rerender dependency.

Coverage: band unit tests, stable rich-message shell tests, MessengerView and
FloatingMessenger tests; browser fixture covers unchanged geometry, empty-space
painting/reversal, fresh strokes, checkbox single toggles, Escape, touch exclusion
and edge scrolling at1440/640/320px, plus mini header geometry/control fit in both
themes. Performance fixture retains502-message DOM (dev first selection473ms;
host-dependent, not an FPS guarantee).114 unit tests, TypeScript, changed-source
ESLint, release-note validation and15 workflow tests passed. Forwarding browser
matrix passed8 theme/viewport cases; no real messages were sent.

TEST release: continue compatibility branch `fix/messenger-launcher-visibility-test`
3d5452f7 and cherry-pick only this scoped patch. Build/recreate web only; retain
schema0102 and all non-web containers. Do not merge compatibility into main.
Prior TEST2.0.061 / localtest-20261019-launcher-visibility-d1c85c0b.
Office server, API, database, EXE and real messages must remain untouched.
