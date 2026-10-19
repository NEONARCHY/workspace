# Round navigation arrows — 19 October 2026

Source: `fix/round-navigation-arrows`, continuing33e61ac5; origin/main2fccd82c
freshly fetched. All Home panel header transitions now share `ws-navigation-arrow`
and Fluent's circular shape. Equal36px sides override Fluent's small icon width
limit without fighting the shared34px minimum height; coarse pointers get48px.
Icons centered, semantic backing, existing names/navigation and focus retained.

The lasting rule is in AGENTS.md and the design-system component guide: backed
icon-only navigation arrows must be circular; reuse the shared class. Explicit
backing-free mini Back, wide text actions and decorative inline arrows are exempt.
No unrelated buttons, business permissions, API/schema or data changes.

Home fixture uses the existing QA theme hook and production dark/satin layers.
Tests cover every Home header class/navigation, browser true-circle geometry,
icon centers, fill, hover, keyboard, touch and forced colors. Update TEST web only
from compatibilitydc3b26a4; retain rollback and verify root/version/readiness and
unchanged non-web services. Prior TEST2.0.064. No office server or EXE update.

Validation:16 PersonalHomeView tests, TypeScript, changed-source/fixture ESLint,
release notes and15 workflow tests passed. Browser checks passed in both themes
at1440/1024/390px, plus48px coarse-pointer target and forced colors/reduced motion.
The dark notification header screenshot was visually inspected. No real writes.

## Delivered TEST

Web2.0.065 / `localtest-20261019-round-arrows-32a8e657`, built
2026-10-19T09:31:05.498Z from compatibility5da64cc0 (source32a8e657).
The browser suite passed again on compatibility; geometry tolerance0.01px avoids
subpixel transform rounding (47.99997px versus48px), without relaxing the circle
requirement. Root/version/API readiness returned200. Only web changed(a9a736b8e20a);
all nine non-web IDs unchanged. Schema0102_merge_leave_task; users3/tasks1/messages133.
Rollback: `yuksalish-localtest-web:pre-round-arrows-20261019` (2.0.064).
Vite5178 stopped. No office/EXE update, push, PR, merge or CI; do not merge the TEST
compatibility branch into main. Continue on `fix/round-navigation-arrows`.
