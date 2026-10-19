# Unread boundary divider — 19 October 2026

Source `fix/messenger-unread-divider`, continuing75d90f58. Renderer only.
The existing entry/arrival hook now returns the captured first-unread ID. The same
anchor renders one accessible, full-width «Непрочитанные сообщения» separator in
ordinary and system rows, after any date heading and before the message. Bubble
grouping breaks at the boundary. The first positioning pass waits for the divider
to commit and aligns its top, so it is not scrolled offscreen above the message.
Read acknowledgement keeps the boundary; leaving/re-entering a read chat removes
it. Mini/full handoff and temporary hiding retain it with the existing row anchor.
Forced colors retain the label and horizontal rules; no new animation or data call.

Validation passed:11 hook unit tests plus2 MessengerView normal/system integration
cases; changed-source lint;12 browser combinations (light/dark ×1440/390/320 ×
mini/full), including one separator, visible initial boundary, read acknowledgement,
draft/history scroll, expansion and read-chat reentry removal. Additional list-to-
full expansion and forced-color horizontal-rule checks passed. After freezing the
pending boundary ID, the final mini/full/list browser rerun and hook tests passed.
Release-note and15 workflow tests passed. No live-account messages were sent.

Final TypeScript check passed; Vite5178 stopped.

Next: cherry-pick only this patch onto
TEST9e0291f4 and replace web only. Preserve rollback, verify version/readiness/data
counts and non-web container IDs. No API/schema/office/installed EXE update.
