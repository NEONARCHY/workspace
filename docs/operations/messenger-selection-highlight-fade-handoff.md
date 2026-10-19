# Synchronized message selection wash — 19 October 2026

Source `fix/messenger-selection-highlight-fade`, continuing44dcee01.
Replaced instant selected background with a persistent message pseudo-element
whose opacity follows the marks'220ms/easing in both directions. No dimensions,
history memo, React state or input handling changes. Pointer-events:none keeps
the wash noninteractive. Reduced motion disables its transition; forced-colors
retains the existing semantic Highlight outline.

Next: verify wash/mark midpoints, individual deselection, last deselection,
re-entry, full/mini themes and reduced motion; update only TEST web by applying
this patch on compatibility8cb22573. No API/DB/office/EXE update.

Additional user requests: forwarding search now explicitly uses a non-expanding
Fluent input with search icon; existing100% width fills the dialog at rest/focus.
Paint gesture starts at1px outside text/2px vertically in text; horizontal copy
stays native. Pointer focus and held-button hover do not prepare reactions.
Pending hover timers are cancelled on pointerdown. Stable isPending callback
does not invalidate the memoized rich history.

Main latency cause confirmed by browser metrics: ancestor user-select change and
ancestor rail selector invalidated the whole502-message subtree. Both now apply
only to visible is-selecting rows (existing observer+80px margin). First movement
to selection fell from1017ms to47.6ms on this shared dev host; style recalc1034ms
to27ms. Not an FPS guarantee or live-account measurement. No history virtualization
or API changes; offscreen rows acquire the rail before scrolling into view.

Checks so far:117 unit tests across MessengerView/selection shell/paint/forwarding,
TypeScript, changed-source ESLint, release notes and15 workflow tests passed.
Browser wash suite covers full/mini light/dark, synchronized midpoints, individual
deselection, last-removal and reduced motion. Paint suite covers1440/640/320px
and mini both themes, stable geometry, reverse toggling, native keyboard/touch
and autoscroll. Forwarding suite passed8 theme/width cases including full-width
search at rest/focus/typing/filtering and ordered retry. Dialog and selected-row
screenshots visually reviewed. Final guard/re-entry checks passed, including
native horizontal text copy. Final502-message sample: pointerdown2.7ms,
first2px vertical movement to selection30.5ms; already-open reactions30.7ms.
All117 unit tests passed again after the final guards; lint clean.
