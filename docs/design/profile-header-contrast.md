# Employee profile header — 2026-10-04

Scope: identity hero, actual recognition summary and three existing profile
navigation buttons. Recognition cards, rarity effects, permissions, APIs and
employee records are unchanged.

## Direction

Keep Gilroy and existing brand tokens: navy #293A55, turquoise #0091A8,
accessible link #006779, selected tint #E0F2F5 and the existing white surface.
The hero has a bounded soft turquoise-to-white wash, a visible neutral border
and aligned avatar/copy. Name 26 px, job title 14 px and supporting labels
12 px establish hierarchy without decorative extra elements.

The actual reward counter uses a navy surface and light text. The active
navigation surface uses the same navy, bold text and existing aria-pressed
state. Inactive buttons remain readable against a cool neutral rail. Existing
SlidingSegmented transform motion and reduced-motion behavior are retained;
no new animation or dependency is introduced.

Container queries adapt to available dialog width, including CSS zoom. Below
680 px the recognition summary sits under identity; below 400 px achievements
get their own row rather than splitting words. Dialog dimensions are bounded
by their parent. A ResizeObserver measures actual pinned-header clearance in
layout pixels; below 550 px viewport height the header scrolls normally so
content remains reachable. Observers disconnect on close/unmount.

Direction and the separate rendered quality gate follow
[Frontend Design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md),
fetched through Lazyweb. Product brand and owner brief take precedence.

## Verification

- TypeScript and scoped ESLint passed.
- Profile/dialog, profile-link and segmented-navigation tests pass, including
  long copy, truthful counters, all navigation targets and observer cleanup.
- `scripts/profile-header-smoke.cjs`: read-only authenticated TEST LAN browser;
  all business writes blocked. Seventeen geometry checks across desktop,
  1024×768, 640×480, 360×640, 320×568, 200% CSS zoom and a long job-title fixture.
- Three axe scans of changed header/navigation states: zero automated WCAG
  A/AA violations. Selected-label contrast exceeds 4.5:1. Native Tab trapping,
  Escape/focus return, reduced motion and forced colors checked.
- Desktop and compact screenshots inspected. Local QA artifacts remain in
  ignored `tmp/profile-header/`; no employee screenshots or tokens committed.

Automated checks are not full screen-reader certification or packaged Electron
testing. Frontend-only release: update TEST LAN `web` only; do not recreate API,
database or background services. Installed Electron remains unchanged.
