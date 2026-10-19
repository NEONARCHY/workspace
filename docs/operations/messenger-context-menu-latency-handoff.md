# Message context-menu startup — 19 October 2026

Source `fix/messenger-context-menu-latency`, continuingc0bed321.
Two independent cold-open causes confirmed on502 synthetic messages:
pointer focus rebuilt rich rows solely for reaction hover state; creating a new
Fluent themed portal invalidated styles across the whole history. Initial sample:
1163.9ms pointerdown-to-mount,447.1ms contextmenu-to-mount,1182.2ms to second RAF.

Secondary pointerdown on a message prevents only its native focus default, not
the contextmenu event; keyboard/programmatic focus behavior remains unchanged.
MessageContextMenu now supports open=false and retains only its empty
Fluent portal host while closed. Menu/actions/reaction controls are fully unmounted
when closed. Container changes remount the portal via a WeakMap identity key, so
mini/embedded dialogs retain the correct modal layer, theme and event ancestry.
ResizeObserver/clamping/focus behavior stays owned by the same component.
No new custom portal implementation, catalog, data, API or history memo dependency.

After patch:36.1ms pointerdown-to-mount,28.2ms contextmenu-to-mount,43.8ms to second
RAF; style recalc5ms. Shared dev-host measurements, not an FPS/live-account promise.
No ReactionPicker changes retained; the existing surface lifecycle is preserved.
The history ref is bound through a stable callback that records its modal portal
container at commit time, without reading refs during render.

Next: focused unit/browser checks for cold/repeat menus, full/mini modal layering,
keyboard/Escape, reactions and actions; cherry-pick only this patch onto TEST
compatibility42acc751 and update web only. Keep rollback, API/DB/office/EXE untouched.

Validation passed:121 MessengerView/MessageContextMenu/ReactionPicker/selection-shell
unit tests, including host reuse and modal container replacement, nested dialog
layering, reaction focus and permissions. Browser cold/repeat benchmark also checks
host identity, quick/full reactions, Shift+F10, Escape, no runtime errors/overflow.
Final sample35.1ms to mount,32.2ms context-to-mount,47.6ms to second RAF; style6ms.
Paint suite passed1440/640/320px plus mini light/dark; forwarding suite passed8
theme/viewport cases. Changed-source lint, TypeScript, release/workflow checks passed.

## Delivered TEST

Web2.0.071 / `localtest-20261019-context-menu-4afca6de`, built
2026-10-19T10:50:08.106Z from compatibilitya52cdf3e (source4afca6de).
Root/version/API readiness returned200. Only web changed(3c3b5ab92568);
all nine non-web IDs unchanged. Schema0102_merge_leave_task and
users3/tasks1/messages133 unchanged. Rollback image:
`yuksalish-localtest-web:pre-context-menu-latency-20261019` (2.0.070).
Vite5178 stopped. No office/EXE update, push, PR, merge or CI.
Continue source `fix/messenger-context-menu-latency`; never merge TEST
compatibility into main. Measurements/checks used synthetic fixtures; no real
account messages or decisions were sent.
