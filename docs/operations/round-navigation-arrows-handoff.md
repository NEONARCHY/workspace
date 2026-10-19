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
