# Notification search surface regression — 19 October 2026

The reserved layout track in `.notification-head-actions` was accidentally painted
by the global dark satin surface selector. Its unused left space appeared as an
empty pill. Exclude only this layout wrapper using the existing
`data-satin-excluded` contract; keep the actual controls and leftward expansion.

Regression coverage: transparent wrapper background, compact circular expanded
search icon, stationary read-all action, filter/reset/read-all, no overlap in both
themes at 1440/1024/640/390/320px. Browser screenshots visually checked at 1440px.
Changed-source lint, release-note validation and 15 workflow tests passed.

TEST delivery uses `fix/notification-search-surface-test`, continuing 89a7a50e.
Web only; do not change API, schema 0102_merge_leave_task or other containers.
Keep this compatibility branch out of main. Transfer the scoped source/test/note
commit to the main-based messenger continuation before publishing source.

Page-scroll rail work remains separately committed at 4fa0ddfc on
`fix/page-scroll-gutters`, not deployed. Complete navigation lifecycle/native
scrollbar measurement checks in its handoff before release. No push/PR/merge is
authorized by this corrective follow-up.
