# Yuksalish Workspace: UI foundation 0.15

## Scope and source of truth

Redesign of the existing Windows corporate application, not a marketing dashboard. References supplied on 2026-09-04 inform whitespace, grouping and surface hierarchy, not their medical content, violet palettes or invented analytics. Information architecture, personal navigation ordering, access rules, existing records and workflow transitions remain unchanged.

Source of truth: the owner-supplied `brand_identity.pdf`, ten pages, visually inspected in full on 2026-09-04. Page 4 specifies turquoise **#0091A8** and navy **#293A55**; page 5 specifies **Gilroy**. Pages 3 and 7 show a minimum 5 px clear space around the artwork; pages 8-10 explain that the sublogo supplements (not replaces) the main logo and must not be stretched or recoloured. Original owner-supplied full-wordmark PNGs remain byte-for-byte unchanged, retain aspect ratio and clear space. Their previous optical alignment on login is preserved. Existing Bitrix stage colours are explicit operational exceptions requested by the owner.

Design read: light enterprise workspace for daily staff use, restrained Fluent UI, clear hierarchy and readable working density. Variance 3 / motion 2 / density 5. Marketing-page effects, stock photos, fake charts and decorative infinite animation do not serve this application.

## Baseline audit

- React 19, Fluent UI v9, React Flow, vanilla CSS. Preserve this stack and the official Fluent components.
- Many labels are 7-11 px; custom controls and Fluent controls disagree about typography and radii.
- Heavy navy rail and edge-to-edge white panels compete with the work area. Some screens use multiple strong separators without hierarchy.
- Hardcoded colours and sizes accumulate across feature CSS and responsive overrides. Introduce semantic tokens shared with a branded Fluent theme.
- Disabled global search promises a capability it cannot provide. Replace with an explicitly scoped, working section switcher.
- Task filter button has no action; provide text search shared by list and Kanban.
- Employee directory has no text search. Preserve role/position editing and provide find-by-name/job-title.
- Calendar events are clickable spans inside day buttons, inaccessible separately by keyboard. Give each event a real button and each day a labelled create action.
- Preserve: original logos and login optical alignment, status-only header, stage colours, exact animated money, hover message actions, ArrowUp editing, pinned/archived chats, navigation ordering, focus/reduced-motion and scoped Fluent portal root.

## Tokens and components

- Palette: navy ink, cool neutral canvas, white surfaces, turquoise accent. Solid surfaces; no expensive backdrop filters over work areas.
- Typography: **Gilroy** Regular (400), Medium (500), SemiBold (600) and Bold (700), bundled locally; Segoe UI is a fallback only during loading. 14 px body, 12 px supporting text, 24-28 px screen titles. Tabular digits for money, dates and counters. Original TTFs copied from the owner's installed Windows fonts, with no download or conversion. Font licensing is not independently certified by this UI audit; the organisation remains responsible for distribution rights.
- Spacing: 4/8/12/16/24/32 px; desktop section gutters 24 px, compact 12-16 px.
- Shape: 8 px small controls, 12 px inputs/buttons and rows, 16 px cards, 20 px major surfaces. Pills reserved for compact statuses.
- Elevation: restrained navy-tinted shadow for raised cards/dialogs; bounded context glow only on meaningful hover, focus and changed amount.
- Structure: light navigation rail, status header, inset work surface; section titles and actions consistently aligned. List/detail split only when content width permits; narrow layouts keep existing explicit back buttons and draft-preserving component identity.
- Primary actions use official navy **#293A55** with white text; official turquoise **#0091A8** provides accents. Small links use an accessible darker derivative **#006779**, because white small text on the official turquoise is below AA contrast. Destructive actions stay red. Selection uses tint plus border/inset marker, not colour alone.
- Motion: 140-180 ms feedback, exact 260 ms existing amount counter. Respect reduced motion and Windows forced colours. No animated shadows, backdrop blur loops, pointer tracking or React state updated per frame.

## Accessibility and verification

Target: WCAG 2.2 AA for affected screens. Automated scans are evidence, not certification; full screen-reader certification is not claimed. Check contrast, labelled controls, keyboard access, visible unobscured focus, zoom/reflow, reduced motion, forced colours and dialog focus restoration. Criteria reference: [W3C WCAG quick reference](https://www.w3.org/WAI/WCAG22/quickref/).

Use axe-core on local authenticated screens with read-only test routes; save before/after screenshots and reports. Run existing unit, responsive, workflows, messenger, personal-organization, payment/trip and branding regression scenarios. Verify the packaged Electron version with an isolated profile before delivering the installer. No test sends real messages or approval decisions.

## Boundaries

API and PostgreSQL remain at 0.14.0 / migration 0017. No backend rewrite, production import, public publishing, new CRM implementation or real organisation data modification. Dark mode and a formal external accessibility certification are separate deliverables; this package implements the supplied light visual direction.

## Verified delivery — 2026-09-04

- 87 frontend unit tests; TypeScript and ESLint pass. The two added integration tests cover shared list/Kanban search (including overdue tasks) and employee search with preserved selection.
- 18 settled-state axe scans in Edge and packaged Electron: login, ten sections, six additional forms/editor/switcher states, account. Zero automated WCAG A/AA violations in these states. Transitional Fluent entrance opacity is awaited, not suppressed; `incomplete` items remain manual-review candidates, not automatic passes. This is not a claim that every possible data state or assistive technology has been certified.
- 83 responsive checks over eight window sizes, repeated with deliberately long text. Forms remain in-bounds; compact navigation, draft preservation and invalid-date handling pass.
- `design-ux-smoke.cjs`: 30 checks in packaged Electron, including actual 200% zoom, dialog bounds, modal Tab/Escape/focus restoration, search, keyboard calendar, four loaded Gilroy weights and CDP verification that Cyrillic glyphs use custom Gilroy, not a system fallback. Native zoom screenshots use BrowserWindow capture to avoid Playwright's CSS-pixel screenshot cropping.
- Branding: 23 Edge / 15 packaged checks, preserved original PNG hashes, optical alignment within one pixel, status-only header. Workflow editor: 11 Edge / 11 packaged checks, no intercepting full-window Fluent portal.
- Message hover/focus/touch and ArrowUp editing, personal pin/archive/navigation ordering, payment exact colours and animated totals, trip decisions and drag/drop all pass their existing regression scripts. Test mutations are intercepted; real business records are not modified.
- Before/after visual artifacts are local ignored files under `tmp/design-before`, `tmp/design-after`, `tmp/design-after-desktop`, `tmp/design-ux-desktop`; all section and form screenshots were inspected, plus the actual 200% native window.

Installer: `apps/desktop/release/Yuksalish-Workspace-Setup-0.15.0.exe`, **145,046,301 bytes**. SHA-256: `84EC1F60B1B28CA878CD30FACF609C23861C6030D9A024E6FB24EE5D08280C02`. Build via `pnpm --filter @yuksalish/desktop dist:win`; packaged Electron reports 0.15.0. Authenticode: **NotSigned**, internal alpha. The existing executable icon was not replaced. Non-blocking build warning: the renderer bundle is about 986 kB minified (281 kB gzip); route-level code splitting is a separate performance follow-up, not a claim of a fully rearchitected backend or bundle.
