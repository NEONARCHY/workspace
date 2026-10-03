# AI module surfaces and mail density

Owner refinement, 2026-10-04. Renderer only; API contracts, permissions,
delivery, attachment storage and robot integration remain unchanged.

AI Referent and AI Hisobot use the existing opaque `--ws-surface`, `--ws-line`
and card shadow instead of full-page radial gradients. The illustrated header
and its foreground layering stay intact. A module-scoped shell gutter restores
the right inset overridden by the assistant's edge-scrollbar rule: both sides
measure 20 px on desktop, 16 px at 1024/800 and 12 px at 390.
The top and horizontal view inset remain intact, but the bottom margin is zero:
the module surface ends on the same baseline as the navigation rail.

Referent tabs and creation actions wrap instead of scrolling horizontally.
The tab surface uses its content width without flex growth; creation actions
follow it with an 8 px gap instead of being pushed to the far right.
The shared selection indicator supports both axes and snaps on resize.
Incoming/outgoing pagination sits above the list; arrow-only buttons keep
Russian accessible names, tooltips, loading/first/last-page guards and the
existing offsets (100 incoming, 50 outgoing). Search/filter changes reset pages.

Incoming document count is the packet opener, not an extra line above it.
The full filename, sender reference, date, status, organisation and responsible
person are retained. Outgoing cards remain individually selectable. Compact
windows retain a bounded inner list; the enclosing view can scroll when wrapped
controls would otherwise hide the list. At heights <=700 the explanatory subtitle
is hidden, but the section title remains visible.

Read-only visual QA uses invented browser-only API responses, never seeded
business records. Screenshots and three alternatives live in ignored
`tmp/ai-mail-layout`; the local comparison report is under
`.lazyweb/design-improve/ai-mail-2026-10-04`. The selected layout fits five complete
incoming rows and six outgoing rows at 1440×900 (baseline two and four).
Smaller viewports, packet Escape/focus, paging, reduced motion and forced colours
are checked alongside the existing Referent/Hisobot/search/selection tests.
