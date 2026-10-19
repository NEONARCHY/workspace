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

## Delivered TEST

Web2.0.066 / `localtest-20261019-symmetric-scroll-d1e1bc7b`, built
2026-10-19T09:47:14.065Z from compatibility3cf7b445 (source d1e1bc7b + f08c6257).
Root/version/API readiness returned200. Only web changed (40172e19fcc5); all nine
non-web container IDs unchanged. Schema0102_merge_leave_task; users3/tasks1/messages133.
Rollback: `yuksalish-localtest-web:pre-symmetric-scroll-20261019` (2.0.065).

On compatibility,8 Home geometry cases and6 full messenger cases passed again.
Vite5178 helper stopped. No office/EXE update, push, PR, merge or CI. Preview note
numbers remain provisional: the unmerged190000 note appears in history as2.0.057
while the latest summary is the arrow note; the actual web build/version is2.0.066.
Numbering metadata was generated normally, not manually reordered.
