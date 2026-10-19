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

## Delivered TEST

Web2.0.073 / `localtest-20261019-unread-divider-35181b59`, built
2026-10-19T11:25:22.745Z from compatibility4849b6b6 (source35181b59).
Root/version/API readiness returned200 at `https://192.168.0.127:8443/`;
web is healthy. Only web changed to8a46d2d69c99; all nine non-web IDs unchanged.
Schema0102_merge_leave_task, users3/tasks1/messages133 unchanged. Rollback:
`yuksalish-localtest-web:pre-unread-divider-20261019` (2.0.072).
No API/schema/office/installed EXE update, push/PR/merge/CI. No live-account
read receipts or test messages were changed by browser QA; fixtures were synthetic.

Continue source `fix/messenger-unread-divider`. Keep TEST compatibility branch
`fix/messenger-unread-divider-test` separate from main. Future unread/pagination
changes must preserve this captured boundary and switch to a server cursor if the
complete-history/atomic-read model changes; see the previous entry handoff.
