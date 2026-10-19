# Floating messenger — 19 October 2026

## Source / scope

Branch: feature/floating-messenger, based on origin/main 665428a6.
Includes local dependency 72fb3ced (the prior forwarding/selection package).
FloatingMessenger reuses a single mounted MessengerView for mini/full mode.
App supplies the existing authenticated handlers; no API/schema changes.
Access remains gated by canView("messenger") and normal server checks.

Only this new frontend commit should be cherry-picked onto the existing TEST
compatibility line (fix/messenger-forward-selection-test at 542e063f).
Do not deploy current main API/schema: TEST is still on 0102_merge_leave_task.
Keep the earlier TEST-only UI refinements and forwarding backend intact.

## Validation

- Desktop typecheck passed; final lint is checked before commit.
- Floating geometry/shell/blocking tests passed (13 current shell tests).
- Messenger-focused run: 113 passed, including the original 101 MessengerView
  tests and earlier 12 shell/geometry/blocking tests. New voice guard adds the
  13th shell test, tested separately.
- App suite passed: 55 existing tests; new global mini/full handoff integration
  passed separately with the same editor node across Home → Tasks → full → mini.
- Voice/FileDrop regression run: 10 passed.
- Browser: 8 theme/viewport cases for unread, actual send/error recovery,
  attachment retention, forwarding menu, drag, persistence and full handoff.
- Accessibility browser: both themes, 1024×768, 640×480, 320×640 and 200% CSS
  zoom; keyboard open/Escape/focus restoration, forced colors and reduced motion.
- Synthetic data only. No real TEST messages were sent. No installed EXE,
  two-real-user delivery or 60 FPS claim.

## TEST before update

HTTPS https://192.168.0.127:8443/ and API readiness returned 200.
Web 2.0.054, build localtest-20261019-messenger-forward-570a5c4b.
Only web is to be built/replaced. No API, DB, worker, scheduler or office update.

## Next step

After final checks, commit frontend changes; cherry-pick onto the TEST-compatible
branch, prepare release-note order, build web, retain the old image for rollback,
replace only web, verify version.json/API readiness/root and record evidence here.
Keep the main-based branch available for later authorized publication/review.
