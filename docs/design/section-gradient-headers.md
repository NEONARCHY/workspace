# Section gradient headers — 2026-10-07

## Owner direction

Extend the Projects / Project Applications banner family to the main workspace
sections: a wide blue-to-teal gradient, restrained subject-specific decoration,
readable copy and clearly separated actions. This is an explicit exception to
the earlier preference for unboxed page headings, not a redesign of record
cards, dialogs, login or account settings.

## Shared grammar

- One page header, normally at least 148 px high; compact container layouts use
  138 px. The messenger keeps a smaller banner inside its existing chat pane.
- White headings and pale supporting text on a bounded navy/teal gradient.
  Primary actions are white with navy text; secondary actions use translucent
  dark surfaces. Segmented navigation remains light with a distinct selection.
- Header navigation uses the same neutral-light family as AI Referent tabs:
  13 px semibold idle labels, navy bold selected labels and a white selection
  surface. Task views, project/trip sections and payment modes share the scoped
  rule; focus and forced-colour selection remain visible.
- Fourteen distinct decorative SVG motifs represent tasks, employees, absences,
  notifications, HR, calendar, trips, team, Telegram access, feed, messaging,
  payments, Zoom and the member registry. The AI modules retain their existing
  subject-specific illustrations. Existing Projects banners remain the reference.
- Artwork is static, hidden from assistive technology and cannot intercept input.
  Compact layouts soften illustrations; forced colors removes them entirely.
- Employee administration tools occupy their own light working row. The calendar
  and feed headers span their respective content grids. Missing integrations
  retain full-width section identity above their original status information.

The component preserves native header props and existing children/handlers.
The stylesheet is loaded after module styles and is restricted to page headers.
Its root selector also outranks the older workflow accent wash; legacy header
pseudo-elements are disabled only on the new banner class.

## Verification

- Complete renderer rerun: 101 test files passed, 677 tests passed, one skipped.
  An initial voice test raced its recording-ready status; its isolated rerun and
  the complete second run passed without changing that unrelated test or feature.
- Added tests cover header semantics, preserved button handlers and fourteen
  unique non-interactive motifs. TypeScript, ESLint, renderer and web builds pass.
- Browser inspection used the owner's isolated personal development site and
  demo records, not the office server. Wide headers and selected compact states
  were inspected at 1912, 1024, 956, 780 and 620 CSS-pixel viewport widths.
- Task list/Kanban/calendar/efficiency and trip workflow tabs remain functional.
  Notification search and employee tools stay separate from decorative artwork.
  Messenger, Zoom and the unconfigured member registry were also inspected.
- Screenshots are local ignored artifacts under `tmp/section-headers`.
  No claim of a new packaged Electron run, actual 200% browser zoom, complete
  assistive-technology certification or configured external integrations.

No API, database, access-rule, workflow or production-server changes. Existing
fonts, tokens, dialogs and record interaction logic remain unchanged.
