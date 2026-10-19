# Yuksalish Workspace: UI foundation 0.15

## Shared inline notices — 15 October 2026

Short contextual feedback uses `WorkspaceNotice`: shared spacing, decorative
semantic icons, separate retry/dismiss actions and the existing dark satin
surface. Field errors, large empty states and screen-reader-only messages stay
distinct. See [inline-notices.md](inline-notices.md).

## Dark satin surfaces — 14 October 2026

The owner-selected reference is the dark `_SatinBorderPainter` in Maqro's Flutter app, not its light variant. `satin-surfaces.css` ports its sweep stops and subdued 0.78 strength: reference white 15.5% at the top, 12.5% corners, 3.8% sides, 2% bottom and 0.7% bottom centre, with a quiet turquoise top sheen. Alpha is premultiplied by 0.78. The gradient is painted in the element's existing transparent CSS border box; opaque padding-box fill clips it out of the content. Border radius and scrolling therefore belong to the real element, with no pseudo-element, mask, absolute positioning or foreground layer. The outer navigation island has no decorative outline or top-edge shadow.

Shared cards, calendar/message panes, floating windows and remaining account, mail, bot-access, employee, notification, survey and participant-picker surfaces use this treatment. Fluent and native fields use the same padding-box/border-box backgrounds. Selected choices strengthen the turquoise sheen; mail errors/warnings keep their semantic colour in a satin sweep. Raised/recessed/selected fills remain explicit, with the established dark header palette. Illustrations, radii, row separators, borderless buttons, avatars, keyboard focus and the light theme remain unchanged. Invalid fields, composer inner inputs and reaction picker's pointer decoration are excluded. System forced colours retain their existing boundaries. No canvas, dependency, per-frame rendering or perpetual animation is added.

### Shared expanding searches — 14 October 2026

Light-theme exception, 16 October: only the selected incoming-letter summary
filter uses the same tapered satin border as dark mode, with teal light-theme
ink and an opaque light fill. The previous solid border plus inset ring is
removed. Unselected light cards, dark surfaces, geometry and focus/forced-colour
signals remain unchanged.

Search height follows the complete adjacent control surface, including segmented
group padding, rather than its inset button. Only visible controls on the same
row participate; resizing remeasures the row. The temporary gooey split keeps
SourceGraphic over the thresholded fill so the actual thin border remains
visible throughout expansion and collapse. No foreground border sprite is added.

## Scope and source of truth

### Shared field borders — 14 October 2026

Field-caption interaction — 15 October 2026: visible labels above inputs,
searches, selects and date controls do not forward pointer clicks to the
control. A shared document-level click observer covers existing wrapping
labels, Fluent Field associations and portal forms without removing their
accessible naming. Direct field/icon/button clicks and keyboard activation
remain unchanged. Intentional checkbox, radio, switch and file-upload labels
retain their native activation. No pointer-events pass-through layer is used.

Task creation sections now retain a rounded surface and a real border in both
collapsed and expanded states. The three dependency controls share equal grid
columns and a 52 px height, stacking at narrow widths. Native disclosure keeps
the same plus glyph and draft nodes; its 240 ms rotation maps 0 to 45 degrees
in both directions, with instant feedback under reduced motion/system colours.

`workspace-field-borders.css` gives Input, Textarea, Select, Combobox and Dropdown
one real border on their sized shell. Native Select children stretch into that
shell and have no separate border. Fluent decorative focus pseudo-elements,
inset highlights and legacy focus halos are removed. Focus changes only the
existing 1 px border to readable cool grey; geometry does not change. Native
fields and date triggers share the no-glow treatment. Dark satin backgrounds,
search splitting, invalid/disabled states, composer transparency and system
forced-colour focus remain explicit; no foreground border layer is introduced.

### Shared contextual menus — 14 October 2026

`workspace-popups.css` applies the messenger message-menu design to dropdown
listboxes, action menus and small contextual popovers: one 17 px rounded
surface, flat 34 px rows (44 px on phones), zero row gaps and edge-to-edge hover.
Checked values, disabled actions, long-label wrapping, keyboard inset focus,
system colours and dark real satin borders remain explicit. Automatic per-row
separators are removed; intentional section dividers remain. Calendar, slider,
person-picker and emoji content retain their functional layout. Full forms and
modal dialogs are not flattened into action menus.

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

### Round navigation arrows — 19 October 2026

Icon-only navigation arrows with a backing always use a true circle, not a pill
or rounded rectangle. Reuse Fluent `Button shape="circular"` with
`className="ws-navigation-arrow"`: equal36px sides, centered icon, semantic fill,
native keyboard focus and48px sides for coarse pointers. The shared CSS overrides
the small icon-only width limit so the global34px minimum height cannot stretch
the circle into an oval. Home panel header arrows all use this pattern.

Explicitly borderless/backing-free arrows (mini messenger Back), wide labelled
actions and decorative arrows inside clickable rows are exceptions; do not add
a second backing to them. This rule applies to new and edited navigation actions.

### Account settings — 2026-10-04

Account settings deliberately opt out of the previous semantic section washes.
White working forms, a quiet canvas and separate personal/administrative
navigation establish hierarchy; accent is reserved for selection and truthful
security statuses. Hidden pages preserve drafts. Container queries adapt the
navigation to the real available width, including CSS zoom. See
[account-settings-redesign.md](account-settings-redesign.md).

- Palette: navy ink, cool neutral canvas, white surfaces, turquoise accent. Solid surfaces; no expensive backdrop filters over work areas.
- Typography: **Inter** 4.1, explicitly requested by the owner on 2026-10-06, replacing the original Gilroy UI policy. Unmodified local variable WOFF2 normal/italic, weights 100–900; Segoe UI is a loading fallback. 14 px body, 12 px supporting text, 24–28 px screen titles; tabular digits for money, dates and counters. Wordmark artwork remains unchanged. [Official release](https://rsms.me/inter/download/), [OFL](https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt); the license ships in `public/licenses/Inter-OFL.txt`. No external font requests at runtime.
- Spacing: 4/8/12/16/24/32 px; desktop section gutters 24 px, compact 12-16 px.
- Shape: 8 px small controls, 12 px inputs/buttons and rows, 16 px cards, 20 px major surfaces. Pills reserved for compact statuses.
- Elevation: restrained navy-tinted shadow for raised cards/dialogs; bounded context glow only on meaningful hover, focus and changed amount.
- Structure: blue/teal navigation rail by default (owner refinement, 2026-10-07), status header, inset work surface; section titles and actions consistently aligned. Personal navy/light alternatives live in Settings → Appearance; see [sidebar-appearance.md](sidebar-appearance.md). List/detail split only when content width permits; narrow layouts keep existing explicit back buttons and draft-preserving component identity.
- Decorative module headers: use `ws-illustrated-header` on the direct header child of `workspace-view`, `ws-illustrated-header-copy` for its title and `ws-illustrated-header-art` for `aria-hidden` artwork. The shared CSS keeps the header below every following section and the artwork below its title, even when illustrations extend beyond the header at narrow widths. Artwork must use `pointer-events: none`; never give the art a page-level `z-index` above tabs, buttons, alerts or content.
- Primary actions use official navy **#293A55** with white text; official turquoise **#0091A8** provides accents. Small links use an accessible darker derivative **#006779**, because white small text on the official turquoise is below AA contrast. Destructive actions stay red. Selection uses tint plus border/inset marker, not colour alone.
- Motion: 140-180 ms feedback, exact 260 ms existing amount counter. Respect reduced motion and Windows forced colours. No animated shadows, backdrop blur loops, pointer tracking or React state updated per frame.

## Accessibility and verification

### Semantic accent surfaces — 2026-10-03

Per the owner's refinement, existing left-edge semantic strips are replaced
with a static horizontal pastel wash: 15% accent at the left, 7% at 42%,
transparent at the right over an almost-white surface. Priority, calendar
event type, warning/success and account-section colours retain their meanings.
Kanban priority is independent of hover/selected/drag shadows; list title cells
receive the same quieter treatment. Transparent borders preserve existing
geometry, while marker pseudo-elements/inset-only strips are removed.
Ordinary separators, progress tracks and thread/timeline connectors are excluded.
Forced colours removes the wash and retains native focus/selection indicators.
No new motion, dependencies, API changes or data mutations are introduced.

Target: WCAG 2.2 AA for affected screens. Automated scans are evidence, not certification; full screen-reader certification is not claimed. Check contrast, labelled controls, keyboard access, visible unobscured focus, zoom/reflow, reduced motion, forced colours and dialog focus restoration. Criteria reference: [W3C WCAG quick reference](https://www.w3.org/WAI/WCAG22/quickref/).

Use axe-core on local authenticated screens with read-only test routes; save before/after screenshots and reports. Run existing unit, responsive, workflows, messenger, personal-organization, payment/trip and branding regression scenarios. Verify the packaged Electron version with an isolated profile before delivering the installer. No test sends real messages or approval decisions.

## Boundaries

### Profile identity contrast — 2026-10-04

The employee profile hero uses a bounded white surface with a quiet turquoise
wash and a visible neutral border. Its truthful reward summary and active
navigation are navy with light readable text. Container queries preserve long
identity copy at compact widths; measured header clearance keeps navigation
targets unobscured. Recognition cards and their effects remain unchanged. See
[profile-header-contrast.md](profile-header-contrast.md).

### Recognition card clearance — 2026-10-04

The profile scroll viewport extends into the dialog's existing 24 px inset,
with 30 px inline padding preserving the content position and leaving room
for hover shadows and tilted edges. Reward and achievement grids share the
same inline alignment; achievement grids no longer add a separate 30 px inset.
Recognition motion, rarity surfaces, focus outlines and reduced-motion behavior
remain unchanged. Scrolling stays inside the profile, not the page.

API and PostgreSQL remain at 0.14.0 / migration 0017. No backend rewrite, production import, public publishing, new business module implementation or real organisation data modification. Dark mode and a formal external accessibility certification are separate deliverables; this package implements the supplied light visual direction.

## Verified delivery — 2026-09-04

- 87 frontend unit tests; TypeScript and ESLint pass. The two added integration tests cover shared list/Kanban search (including overdue tasks) and employee search with preserved selection.
- 18 settled-state axe scans in Edge and packaged Electron: login, ten sections, six additional forms/editor/switcher states, account. Zero automated WCAG A/AA violations in these states. Transitional Fluent entrance opacity is awaited, not suppressed; `incomplete` items remain manual-review candidates, not automatic passes. This is not a claim that every possible data state or assistive technology has been certified.
- 83 responsive checks over eight window sizes, repeated with deliberately long text. Forms remain in-bounds; compact navigation, draft preservation and invalid-date handling pass.
- `design-ux-smoke.cjs`: 30 checks in packaged Electron, including actual 200% zoom, dialog bounds, modal Tab/Escape/focus restoration, search, keyboard calendar, four loaded Gilroy weights and CDP verification that Cyrillic glyphs use custom Gilroy, not a system fallback. Native zoom screenshots use BrowserWindow capture to avoid Playwright's CSS-pixel screenshot cropping.
- Branding: 23 Edge / 15 packaged checks, preserved original PNG hashes, optical alignment within one pixel, status-only header. Workflow editor: 11 Edge / 11 packaged checks, no intercepting full-window Fluent portal.
- Message hover/focus/touch and ArrowUp editing, personal pin/archive/navigation ordering, payment exact colours and animated totals, trip decisions and drag/drop all pass their existing regression scripts. Test mutations are intercepted; real business records are not modified.
- Before/after visual artifacts are local ignored files under `tmp/design-before`, `tmp/design-after`, `tmp/design-after-desktop`, `tmp/design-ux-desktop`; all section and form screenshots were inspected, plus the actual 200% native window.

Installer: `apps/desktop/release/Yuksalish-Workspace-Setup-0.15.0.exe`, **145,046,301 bytes**. SHA-256: `84EC1F60B1B28CA878CD30FACF609C23861C6030D9A024E6FB24EE5D08280C02`. Build via `pnpm --filter @yuksalish/desktop dist:win`; packaged Electron reports 0.15.0. Authenticode: **NotSigned**, internal alpha. The existing executable icon was not replaced. Non-blocking build warning: the renderer bundle is about 986 kB minified (281 kB gzip); route-level code splitting is a separate performance follow-up, not a claim of a fully rearchitected backend or bundle.

## Section identity banners — 2026-10-07

At the owner's explicit request, main section headings now share the Projects
blue/teal banner family with distinct restrained motifs. Working controls keep
contrasting surfaces; dense employee administration tools remain in a separate
light row. Dialog, record and account headings are not converted. See
[section-gradient-headers.md](section-gradient-headers.md) for scope and checks.

## Complete colour themes — 2026-10-13

The shared web/Electron renderer supports light, dark and system preferences,
plus a quick sun/moon action in the global bar. This adds dark mode to the
historical light-only packages described above; it does not change their layout,
business rules, permissions, metrics, API or original company artwork.

- `color-theme.ts` owns validated per-employee local preferences, cross-tab and
  system synchronisation. The last preference is also cached for an external,
  CSP-compatible classic pre-paint script. It must run before the React bundle;
  Vite deliberately copies it as a public asset rather than bundling/defering it.
- The HTML `data-color-theme` attribute is the common scope for lazy styles and
  portals. `workspaceDarkTheme` supplies Fluent tokens. Custom surfaces/text use
  semantic `--ws-theme-*` roles, with their exact original light values retained
  as fallbacks. New UI should reuse these roles rather than add light-only
  literals. Do not recolour/invert logos, photos, emblems or authored documents.
- Owner's CRM-dark references (2026-10-13) replace the blue-tinted base with a
  graphite canvas `#101115`, recessed `#14151a`, working `#1b1c22`, raised
  `#262730` and selected `#30313d` surfaces. Text is `#f0f0f4` / `#b0b2bf`;
  restrained turquoise `#9bd5d4` marks links and actions, not every surface.
  Static top-edge light and a bounded violet sidebar wash establish depth.
  Section headers (including the project hub) are graphite, not teal banners.
  Status washes and
  readable status inks are paired; control borders meet 3:1 on tested surfaces.
  Source PDF/Office paper remains light, while the viewer controls are themed.
- Theme changes fade the live document out/in over 120/200 ms without remounting
  React. A newer choice retargets the animation. Reduced motion, forced colours
  or a hidden document apply immediately, including interruptions mid-fade.
  Hover uses surface/edge changes, not a general neon glow; no new animated blur,
  text scaling, broad `!important` or `transition: all` is introduced.
- Recognition rarity and optical artwork are retained. Dark foil/glare are
  restrained; locked emblems are subdued without lowering text opacity.
  AI thinking uses its existing canvas renderer with the resolved theme and a
  static forced-colours alternative. Sidebar palette choices remain independent.

The colour and motion decisions follow the Color Expert and Emil Design
Engineering guidance linked in [dark-theme-roadmap.md](dark-theme-roadmap.md).
That roadmap records real-component screenshots, dark/light regressions,
contrast measurements and release status. Automated contrast checks cannot
resolve all gradients/optical layers; they complement visual review, not a
claim of full accessibility certification or physical-device/Electron testing.

## Compact header — 2026-10-14

Search is a labelled magnifier button, not a pretend input. Its command dialog,
Ctrl+K, permitted results and focus restoration are unchanged. On phones up to
600 px, menu, search, theme, assistant and profile form one equal-slot row with
48 px touch targets. Without assistant access the row uses four slots. The
workday control occupies the second row; its label is centered and the server
status has a separate accessible trigger at the left. Tablets keep the controls
in one aligned row. Shared theme tokens and existing popover behavior remain.

## Application icon — 2026-10-14

The owner-provided square Y mark is the source for the Windows executable icon,
browser favicon and web shortcut icons. Its original colors, transparent outer
area and white circle are preserved; the full wordmark used inside the app is
unchanged. The source is `apps/desktop/build/app-icon-source.png`; regenerate
derived sizes with `apps/desktop/scripts/build-app-icons.py` using the project
Python environment. A deployed web build updates browser shortcuts after the
browser refreshes its icon cache; installed Windows shortcuts require a new
desktop package. Merely merging this change does not update either deployment.
