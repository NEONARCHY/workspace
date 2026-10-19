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
