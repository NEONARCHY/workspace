# Messenger launcher morph and notification search — 19 October 2026

Source branch: `fix/messenger-launcher-morph`, continuing the main-based
`feature/floating-messenger` package. Notification search change: d648d8b2.
Only frontend changes; no new contract, API, migration or data writes.

The launcher disappears into a 320ms clip-path expansion from its saved 48px
footprint. The panel occupies that footprint instead of floating above a second
button. Closing reverses the mask in 260ms, then restores focus after React has
made the launcher visible. Text/layout are never scaled and MessengerView stays
mounted. Reduced motion/forced colors skip motion; resize/hidden tab/preferences
finish it. Native title replaces the disappearing Fluent Tooltip, whose Escape
handler otherwise consumes the first Escape after opening with the keyboard.

Notification header reserves a stable grid track: the search is right-aligned
and grows left while the read-all action stays in place. Narrow screens clamp
the search without overlapping or wrapping the action on focus.

Validation: desktop typecheck/full lint; 15 shell/geometry/blocking unit tests;
notification browser test in both themes at 1440/1024/640/390/320px;
messenger browser tests for draft/files/send-error/unread/drag/full-page handoff;
dedicated morph test samples initial and intermediate opening/closing masks at
default and moved positions. Accessibility checks cover Escape/focus, both themes,
forced colors, reduced motion, 320px width, 480px height and 200% zoom.
All browser data is synthetic. No real-account sends, installed EXE or FPS claim.

Deployment must use a compatibility branch from `feature/floating-messenger-test`
(dcf16461), cherry-picking only the two new fixes. Do not deploy main API or
merge the older TEST compatibility line back into main. Keep schema
0102_merge_leave_task and existing forwarding backend. Before this change TEST
web is 2.0.055 / localtest-20261019-floating-messenger-135a588d at
https://192.168.0.127:8443/. Update web only; retain rollback image and verify
root/version/readiness plus unchanged non-web container IDs after replacement.

Full lint on the older TEST line has the already documented unrelated
TripApprovalsView.tsx:92 immutability issue. Do not weaken rules to hide it.
No push, PR, merge or office update is part of this follow-up.

## Delivered TEST

Code/build revision: 773545ca (compatibility branch fix/messenger-morph-search-test).
Web 2.0.056, build localtest-20261019-morph-search-773545ca,
builtAt 2026-10-19T08:01:10.526Z. Root, version.json and API readiness returned
200 at https://192.168.0.127:8443/ after replacement.

Only web was recreated: container 3da7cc8cb3e3. API remains 60a24a287228;
worker/scheduler/gateway/HTTPS/office-preview/Postgres/Redis/MinIO IDs unchanged.
Schema remains 0102_merge_leave_task; users=3, tasks=1, messages=133.
Rollback image: yuksalish-localtest-web:pre-morph-search-20261019 (2.0.055).

Compatibility source passed typecheck, 15 unit tests and all four browser
scripts (search, messenger flow, morph, accessibility). Full lint passed on
main-based source; changed-source lint passed after the final lifecycle fixes.
The earlier TEST-wide lint limitation remains separate from this change.

Next: publish/review the main-based fix/messenger-launcher-morph branch when
authorized. Never merge the TEST compatibility branch into main. This final
handoff/release-note clarification has no runtime changes after the built revision.
