# Latest-message navigation and deliberate paint threshold — 19 October 2026

Source `feat/messenger-jump-latest`, continuing55fcbf37. Renderer only.
Inherited overlap warning PR216 concerns App/dashboard files, not changed here.

Shared Conversation wraps the existing scrolling history in a flex/relative
viewport. The circular Fluent Button uses shape=circular +ws-navigation-arrow,
floats above the variable-height composer and never enters history flow. It is
inert/aria-hidden when near the end, appears with opacity/translation, and has an
accessible unread label. Clicking scrolls to latest and focuses the pane; reduced
motion/forced colors use an instant jump and no reveal motion. No global smooth
scroll or layout/text-scale animation was added.

useMessageScrollNavigation retains viewport-local unseen incoming IDs, because
the current server marks all receipts read on opening. Seed from the already-
captured first-unread boundary; own sends/edits do not increment. Viewing at least
half a message (or half the viewport for tall messages), scrolling past it, or
jumping to latest clears candidates. New incoming messages while above history
increase the badge without pulling the viewport. Do not represent this local
counter as a change to server receipts/global unread. Full receipt semantics or
partial-read APIs are outside this UI patch.

Only unread candidate elements are measured on coalesced RAF updates. Rich rows
are memoized independently of navigation state. Consume geometry after parent
mini/full anchor restoration, not during transient reflow. Temporary hiding keeps
the session; chat-list closing resets it. Closing also synchronously clears the
arrival hook's divider ID via conditional previous-open state, preventing stale
seeding on a read-chat reentry. Existing search hides the control without marking
the filtered history as read. Resize/media load refresh the bounded viewport.

Paint activation now requires20px Euclidean motion outside text or20px vertical
motion within text. Horizontal native text copy remains intact. No hold timer;
crossed bands/reverse toggling and immediate processing after the threshold remain.

Validation passed:23 hook/paint unit tests +4 focused MessengerView regressions;
changed-source lint;12 browser theme/width/mode cases (light/dark ×1440/390/320 ×
mini/full), covering exact local unread count, no fake badge for read history,
incoming/no scroll pull, own-send follow, mini/full handoff, circular geometry,
keyboard focus, reduced motion/forced colors and no horizontal overflow. Final
mini/full rerun plus400-message99+ badge and320×300 collapsed/640 restored viewport
checks passed. Control is hidden below80px history height, retaining pending IDs.
Existing first-unread/divider mini/full/list-to-full browser regression passed.

Trusted pointer test on502 synthetic messages passed:19px does not start selection,
20px does, native horizontal copy remains. Threshold-to-selection43.1ms;58.3ms
after reactions already open; pointerdown3.2ms. Shared dev host, not an FPS claim.
Release-note validation and15 workflow tests passed. QA never sent real messages.

Final TypeScript check passed; Vite5178 stopped.

## Delivered TEST

Web2.0.074 / `localtest-20261019-jump-latest-7bf0b554`, built
2026-10-19T11:39:15.515Z from compatibilityc211ef1b (source7bf0b554).
Root/version/API readiness returned200 at `https://192.168.0.127:8443/`;
web is healthy. Only web changed to49a59fdae655; all nine non-web IDs unchanged.
Schema0102_merge_leave_task, users3/tasks1/messages133 unchanged. Rollback image:
`yuksalish-localtest-web:pre-jump-latest-20261019` (2.0.073).
No API/DB/office/installed EXE update, push/PR/merge/CI. Browser interactions and
incoming-message fixtures were synthetic, not real-account writes.

Continue source `feat/messenger-jump-latest`. Never merge TEST compatibility branch
`feat/messenger-jump-latest-test` into main. If changing receipt semantics/history
pagination, keep the captured entry boundary and use an explicit server cursor;
the current per-viewport badge intentionally does not alter global read receipts.
