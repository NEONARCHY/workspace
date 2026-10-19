# Symmetric page scroll rail — 19 October 2026

Branch `fix/symmetric-page-scroll`, continuing e7998264 and finishing scoped
4fa0ddfc WIP (now f08c6257). Origin/main2fccd82c freshly fetched. The prior WIP was
not deployed; its old4px geometry was never a TEST fix.

One native page owner (`app-stage > app-content`), no stacked trailing root
padding. Painted thumb has equal visible gaps: desktop7+6+7=20px, coarse6+8+6=20px;
compact shell12+6+12=30px (32px coarse). Overlay inset is measured separately from
painted width. ResizeObserver/resize update CSS variables without per-scroll
geometry work; cleanup removes observers/listeners/RAF/styles.

Shared scroll resets inside the committed Suspense subtree, never while the old
page is retained, on data refresh, or when obsolete navigation resolves. Unit
coverage includes these cases, classic/overlay reservation and cleanup. Native
inner lists, lanes, chat, menus and dialogs remain independent.

The page-canvas fixture uses real WorkspaceSectionContent, real Home/Team and
Survey through App's display:contents wrapper, alongside16 root samples and other
screens. Browser checks measure leftGap === rightGap, no horizontal overflow,
PageDown and bottom reachability in both themes at four widths.

For TEST continue compatibility9aa37049. Cherry-pick only the two scoped scroll
commits; never deploy main's API/schema or merge compatibility into main. Prior
TEST2.0.065; update web only, retain rollback and all non-web services. No office
server/EXE update or business mutations.

Validation:216 geometry/keyboard cases across27 layouts ×2 themes ×4 widths;
mouse/touch100/200% zoom and forced colors;6 full messenger portal/navigation/mini
cases.21 unit tests, changed-source ESLint, release notes and15 workflow tests
passed. Dark Home and Team fixture screenshots visually reviewed. These are
synthetic fixtures, not a manual check of a live employee account.
