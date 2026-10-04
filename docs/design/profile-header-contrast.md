# Employee profile header — 2026-10-04

Scope: identity hero, actual recognition summary, overview metric surfaces and
three existing profile navigation buttons. Recognition cards, rarity effects, permissions, APIs and
employee records are unchanged.

## Direction

Keep Gilroy and existing brand tokens: navy #293A55, turquoise #0091A8,
accessible link #006779, selected tint #E0F2F5 and the existing white surface.
The hero has the same pastel turquoise-to-blue-neutral wash for every employee,
independent of avatar color, a quiet neutral border and aligned avatar/copy.
Name 26 px, job title 14 px and supporting labels
12 px establish hierarchy without decorative extra elements.

The actual reward counter uses a pastel turquoise/blue-neutral surface and dark
text. Per the latest owner refinement, profile navigation reuses the exact
EmployeeScopeSwitch appearance: a white moving active surface, navy selected
text, 11 px neutral rail, 3 px inset/gap, and 34 px controls. The profile retains
three equal columns and the existing aria-pressed/aria-controls state. Inactive
buttons use the shared muted foreground; reward-section actions remain pastel.
The four overview cards fade their semantic accent from 18% on the left through
7% at 48% to white on the right, without adding accent strips. Existing
SlidingSegmented transform motion and reduced-motion behavior are retained;
no new animation or dependency is introduced.

The profile adds the shared `employee-scope-switch` visual class rather than
duplicating its palette and button rules. Legacy profile-specific backgrounds,
active gradients and typography overrides are removed. SlidingSegmented still
owns the single interruptible 260 ms transform indicator; reduced motion and
forced-colors remain intact. Guidance: [Emil Design Engineering](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md),
read through Lazyweb; cohesion and reuse take precedence over a new visual variant.

Container queries adapt to available dialog width, including CSS zoom. Below
680 px the recognition summary sits under identity; below 400 px achievements
get their own row rather than splitting words. Dialog dimensions are bounded
by their parent. A ResizeObserver measures actual pinned-header clearance in
layout pixels; below 550 px viewport height the header scrolls normally so
content remains reachable. The measured header also unpins whenever less than
120 layout pixels would remain below it, covering CSS zoom and long identity
copy independently of viewport media queries. Observers disconnect on close/unmount.

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

## Scope-switch parity refinement — 2026-10-04

- 12 profile and sliding-navigation tests passed, including shared visual-class
  membership, decorative indicator and all three reachable section targets.
- TypeScript, scoped ESLint and release-note validation passed.
- Actual computed rail/background/border/radius, button colors/font/padding and
  white indicator matched EmployeeScopeSwitch in the synthetic rendered fixture.
- Desktop, 640×480 and 1024×768 at 200% checked: internal scrolling kept the
  navigation reachable, no horizontal page overflow; a settled axe scan returned
  zero automated violations. Existing motion remained 260 ms transform-only.
- Hero, overview washes, recognition cards and business actions were not changed.

## Pastel revision verification — 2026-10-04

The owner-requested pastel revision follows
[Color Expert](https://github.com/meodai/skill.color-expert/blob/main/SKILL.md)
for brand-derived washes and legible foregrounds, and
[Responsive Design](https://github.com/wshobson/agents/blob/main/plugins/ui-design/skills/responsive-design/SKILL.md)
for content-driven boundaries, fetched through Lazyweb. No new dependency.
QA uses genuine renderer components with synthetic, read-only fixtures;
the historical authenticated smoke checks above are not claimed as rerun.

- 20 scoped profile, presence-summary and sliding-navigation tests passed;
  TypeScript, scoped ESLint and release-note validation passed.
- Rendered profile at 1024×768, 640×480, 320×568 and 200% CSS zoom;
  no horizontal overflow, actual header unpins when necessary, tabs retain
  the pastel moving indicator. Two employees share identical computed hero colors.
- Rendered 100-person presence lists at 1024×768, 640×480, 320×568
  and 1024×768 at 200%; footer remained visible, only the list scrolled.
  Keyboard Ctrl+End reached employee 100; Escape and close controls worked.
- Stable synthetic profile and presence axe A/AA scans reported zero violations.
  These checks do not certify all app screens, assistive tools or the EXE.
