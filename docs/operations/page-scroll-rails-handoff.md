# Page scroll rails — work in progress, not deployed

Branch fix/page-scroll-gutters, based on origin/main 2fccd82c.
CSS geometry currently passes 200 layout/keyboard checks (16 root variants,
9 real components × 2 themes × 4 widths). Mouse/touch, forced colours and
100/200% CSS zoom also pass within the supported minimum width. Desktop
typecheck/lint, QA fixture typecheck and 23 focused tests passed.

Do not deploy this package yet. Remaining before release:

1. Move shared scroll position lifecycle into WorkspaceSectionContent: reset
   only after a new deferred section commits, retain on data refresh. Add tests.
2. Measure the actual scrollbar inset in that shared container for overlay
   scrollbar platforms instead of relying only on 6/8px CSS fallbacks.
3. Add a real survey fixture through App's display:contents persistence wrapper;
   the scoped CSS already includes this wrapper. Validate its right rail.
4. Recheck the full messenger slot and inner scroll regions on the TEST-compatible
   line, then deploy web only from a compatibility branch after all checks.

The owner's latest screenshot reports a notification-search visual regression
on TEST 2.0.056. Prioritize that repair. No page-scroll changes have been built
or deployed to TEST. Keep its API/schema 0102_merge_leave_task and current data.
TEST compatibility branch before further work: fix/messenger-morph-search-test
89a7a50e; deployed code 773545ca / localtest-20261019-morph-search-773545ca.
Do not merge the older compatibility line into main or deploy the newer main API.
