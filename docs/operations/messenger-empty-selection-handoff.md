# Exit empty message selection — 19 October 2026

Branch `fix/messenger-exit-empty-selection`, continuing e33f7347; origin/main
2fccd82c freshly fetched. Messenger selection mode now derives from the actual
eligible selected messages, not a separate boolean that can remain true at zero.
Last deselection immediately restores the normal header and hides the toolbar
and circular marks. Checkbox/bubble/keyboard/paint paths share the same invariant.
No effect-driven extra render, history memo dependency, gesture stop or API change.
Ongoing painting can select a later row again; forwarding ordering/cancellation,
attachments and success/error handling are unchanged.

Regression coverage: three last-deselection unit paths plus existing forwarding
and rich-message shell tests. Browser paint suite covers drag removal to zero,
checkbox removal/re-entry and mini keyboard/pointer removal in both themes, with
unchanged history geometry. No real messages or rewrite/API mutations are sent.

For TEST continue compatibilityacb936d0, cherry-pick only this scoped patch and
update web only. Prior TEST2.0.066; retain rollback, verify root/version/readiness
and unchanged non-web containers. No office server, schema, data or EXE update.

Validation:107 MessengerView/selection-shell tests, TypeScript, changed-source
ESLint, release-note validation and15 workflow tests passed. Paint browser checks
passed at1440/640/320px and mini light/dark, including last-removal mode exit,
re-entry, native keyboard/pointer controls and stable history geometry.
