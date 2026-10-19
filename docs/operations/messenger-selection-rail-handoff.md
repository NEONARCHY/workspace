# Animated message selection rail — 19 October 2026

Branch `fix/messenger-animated-selection-rail`, continuing ca6e507f.
Removed unconditional 36px message-row padding and its date-centering offset.
Selection state on the scroll pane translates outgoing message content by 36px
using its existing 38px left clearance. Bubble widths, wrapping, row heights,
date centers and cached paint-selection vertical bands remain unchanged.
Only translate animates (220ms); reduced motion disables it. No history rebuild,
API, database, forwarding or attachment contract changes.

Regression: selection-rail browser script checks both themes at1440/640/320px,
normal right alignment, selected clearance, reverse animation midpoint, identical
text geometry and reduced-motion restoration. Existing paint and forwarding
suites cover the shared full/mini implementation and circular right-side marks.

Next release: cherry-pick the scoped patch onto TEST compatibility2b52892a;
build and replace web only, retain rollback and verify non-web container IDs.
No office server, database, API or EXE update.

Checked: TypeScript, changed-source ESLint, release-note validation and15
workflow tests. Rail browser suite passed6 full-page cases plus mini light/dark
with a long outgoing bubble; screenshot visually reviewed. Existing paint suite
passed1440/640/320px plus mini light/dark; forwarding suite passed8 theme/width
cases. All112 MessengerView, selection shell and paint-hook unit tests passed.
