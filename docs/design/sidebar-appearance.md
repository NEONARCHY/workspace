# Sidebar appearance — 2026-10-07

The owner's dark blue/teal reference supersedes the earlier light-rail default.
This is a navigation-only palette, not a dark theme for the entire workspace.
The light work canvas, settings forms, information architecture, permissions,
notification counts and navigation order are unchanged.

## Behaviour

- The main rail defaults to a subtle `#21475b` → `#205968` gradient.
- Pale labels/icons, a light selected row and distinct counters keep navigation readable.
- The existing unmodified white wordmark is used on both dark palettes; the original
  colour wordmark returns for the light palette.
- Profile Settings → Appearance offers blue/teal, navy and light, applies immediately,
  and marks the default. The page is available to ordinary employees as well as admins.
- The More drawer, AI-module popover, inline AI links, collapsed rail and navigation
  editor use the same scoped `--ws-rail-*` tokens. Portals receive the selected palette
  explicitly; no global Fluent theme or business API is modified.
- More has its own selected surface while open; it does not move the current page's
  sliding indicator. The drawer heading has no count. Existing live section counters
  stay at the right of their own buttons; sections without a count get no invented badge.
  The number on the More trigger still means hidden sections, not unread notifications.

## Persistence and fallback

The validated `blue-teal | navy | light` preference lives in localStorage under
`yuksalish:sidebar-theme:<userId>`. It is separate for each employee on this browser
or Electron profile, survives reopening/relogin, and synchronizes between tabs of
the same origin. It does not sync to other devices and needs no server migration.
Missing, malformed or inaccessible storage falls back to the new default. Failed
writes keep the live choice in memory and display an honest non-persistence notice.

## Verification

Focused tests cover defaults, invalid storage, per-user isolation, remounts, live
updates, cross-tab events, write failure, employee access and themed portal rerenders.
CSS contrast tests cover all three palettes, both gradient endpoints, hover,
selected text/icons, counters and keyboard focus; new labels have Uzbek Cyrillic
and Latin translations. Forced-colours uses native system colour tokens.

Browser checks on the isolated personal development site cover immediate switching,
light selection retained after reload and login, keyboard Space/Escape, collapsed AI
popover, More drawer, desktop, 1024×768, 620×900 and a 956×454 reduced work area.
The latter checks constrained reflow, not an assertion of a real browser 200% zoom
test. No full screen-reader certification or packaged Electron verification is claimed.

The More visibility follow-up passed 79 focused renderer tests (including actual
App section counters), lint, typecheck, production renderer build and 15 workflow
tests. The read-only `qa/ai-navigation.html?overflow&theme=navy` fixture verifies
the shared production components/styles without API calls: all three palettes,
page selection retained beside open More, right-aligned counters, Space/Escape,
section selection, desktop, 1024×768 and 620×900. These are browser checks, not
packaged Electron or full screen-reader certification.

Shipping this renderer change requires updating the web client or rebuilding the
desktop client. The API, database and Exat robot require no update.
