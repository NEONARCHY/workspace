# Synchronized selection marks — 19 October 2026

Source branch `fix/messenger-selection-mark-fade`, continuing b57a0d6b.
Checkbox opacity uses the same220ms/easing as message translation. Hidden marks
remain painted only for the exit transition; visibility becomes hidden at its
end. aria-hidden/inert and pointer-events remove interaction immediately.
Starting-style handles newly observed visible rows. Reduced motion removes both
transitions. No timers, rich-history dependency, layout or API changes.

Next: verify real opacity transition midpoints in both directions, rapid re-entry,
last deselection, Escape, reduced motion and mini; deploy web only to TEST from
compatibility4e199c74 with rollback. No API/DB/office/EXE change.

Browser checks passed: full/mini in both themes, actual opacity and translation
midpoints on entry/exit, immediate inert/aria-hidden/pointer exclusion, last
deselection and reduced motion. Existing paint suite passed1440/640/320px plus
mini light/dark. TypeScript, changed-source ESLint, release notes and15 workflow
tests passed. All107 MessengerView/selection-shell unit tests passed, including
inactive/active inert and aria-hidden regression assertions.

## Delivered TEST

Web2.0.069 / `localtest-20261019-mark-fade-a2175a8a`, built
2026-10-19T10:14:12.683Z from compatibility40780d91 (sourcea2175a8a).
Root, version and API readiness returned200. Only web changed(1d973438f09c);
all nine other container IDs unchanged. Schema0102_merge_leave_task and
users3/tasks1/messages133 unchanged. Rollback image:
`yuksalish-localtest-web:pre-selection-mark-fade-20261019` (2.0.068).
Vite5178 stopped. No office/EXE update, push, PR, merge or CI.
Continue source branch `fix/messenger-selection-mark-fade`; never merge TEST
compatibility into main. Browser checks use synthetic fixtures, not a live account.
