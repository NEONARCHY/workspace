# Mini-messenger shadow during reveal — 19 October 2026

Source: `fix/messenger-morph-shadow`, fresh main 2fccd82c plus the existing
main-based messenger continuation. Scope: renderer geometry and elevation only.

Root cause: clip-path on the same element as box-shadow clips that shadow until
the reveal animation is removed. A bounded fixed elevation wrapper now owns the
static drop-shadow, calculated after its child's clip-path. The child remains the
same mounted section; only the wrapper owns placement. No text scaling, shadow
blur interpolation, new timer, per-frame React work or fullscreen filter layer.
Opening/closing duration and interruption/focus lifecycle remain unchanged.
Full-page and forced-colours modes have no external filter/shadow.

Validation: 11 existing floating-window/layout unit tests, desktop typecheck and
changed-source lint passed. Morph browser regression compares real shadow pixels
outside a partially revealed boundary at 110ms with the same paused frame without
the filter, in both themes and default/moved positions. Initial mask remains48px,
draft/reduced-motion and reverse transition remain covered. Release validation
and 15 workflow tests passed. No physical-device or installed Electron/FPS claim.

TEST must continue `fix/messenger-selection-test` (622d8602), applying only this
scoped patch. Do not deploy main API/schema or merge TEST compatibility into main.
Update web only, preserve schema0102 and all non-web containers; retain rollback
image and verify root/version/readiness after replacement. Current TEST before
this patch: 2.0.058 / localtest-20261019-selection-fbb39c27 at
https://192.168.0.127:8443/. Office server/EXE/DB are outside this request.
