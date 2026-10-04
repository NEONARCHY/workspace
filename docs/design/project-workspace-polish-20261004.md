# Projects and funding workspace polish — 2026-10-04

## Scope and design decisions

This is targeted UI polish for `ProjectHubView`, not a replacement of the older
project list or payment modules. Existing permissions, budgets, approval routes,
private drafts and upload retry ordering remain unchanged.

- Keep Gilroy, navy `#293A55`, turquoise `#0091A8`, contrast link `#006779`,
  white working surfaces and the shared muted canvas `#F2F6F6`.
- Replace the large decorative dark hero with a compact, readable context header.
- Stretch the project index and detail surface; give the filter its own full-width
  row and make the empty detail state explain the next action.
- Match the main surface's bottom edge to the navigation rail, preserving the
  global toolbar above it and the outer right gutter.
- Funding lanes use remaining desktop height instead of a fixed 420/610px cap.
  Long lists scroll inside their lanes. Compact screens scroll the working canvas,
  not the whole page; the board retains its intentional horizontal scroll.
- Use a compact file drop target with visible drag feedback. Each selected document
  has one full name, size, upload state and correctly named remove action.
- Keep employee scope labels on one line, with more room for “Центральный аппарат”.
  Dialog footers remain reachable with internal scrolling.

CSS changes are isolated in the final `project-workspace.css` layer; the shared
dropzone adds optional delegated file-list rendering and safe drag feedback.

## Verification

- 26 tests passed across ProjectHubView, WorkspaceFileDropzone and
  ScopedPeopleCheckboxes, including draft/upload retries, file identity/removal,
  disabled drops and no creation before confirmation.
- Desktop TypeScript and changed-file ESLint passed; release notes validated.
- An isolated Vite fixture rendered the real components and complete renderer
  stylesheet stack, using synthetic data and an in-memory fetch stub. No business
  writes or real attachments were sent to any server.
- Forms checked at 1440×900, 1024×768, 640×480, 360×640 and 320×568.
  Scope labels did not wrap or overflow; footer remained inside the viewport.
- Project form checked at 200% CSS zoom: no horizontal form overflow and panel
  inside viewport. The existing Fluent Escape lifecycle still closes the dialog.
- Empty projects and empty funding canvas each passed axe WCAG A/AA checks.
- Filled fixture used 32 requests; all four lane stacks scrolled internally
  (440px client height, 1369px content in the measured desktop layout).
- At 1440×900, empty funding lanes measured 550px tall and ended 29px before the
  main surface's bottom, including padding and the horizontal-scroll allowance.
  Rail and surface bottoms both measured 886px.
- Narrow filled project inspection exposed a fixed minimum workstream-grid width;
  it was corrected and rechecked down to 320px with no detail overflow.
- A real local file chooser selected a synthetic long-named text file into the
  fixture only. Its name and remove action fitted at 320px; no file was uploaded.

Authenticated LAN browser inspection was blocked by the browser tool's URL policy;
this was not bypassed. Visual results above are isolated component checks, not a
claim of authenticated end-to-end LAN verification. The deployed test site's
version, page availability and API readiness are checked separately by HTTP.

## Guidance used

Lazyweb Apply Design Best Practices routed to
[Frontend Design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md):
restrained brand palette, clear working hierarchy, useful empty states and explicit
responsive inspection. Testing/QA guided the unit and isolated-browser checks;
unavailable optional testing subskills were replaced by the existing Vitest stack.

No push, pull request or merge is part of this task, per the owner's cancellation.
