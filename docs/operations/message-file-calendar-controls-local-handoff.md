# Message/file/calendar controls — local + TEST web

Branch `fix/message-file-and-calendar-controls`, worktree `tmp/emoji-theme-polish`,
base `fbad945a` (previous deployed incoming satin package).

- Attachment dialog initially focuses caption. Enter sends, Shift+Enter newline;
  Ctrl/Command+Enter preserved; IME/repeat/blocked/empty guards. Explicit button focus
  retains native keyboard activation.
- Shared PDF.js PDF/Word preview: non-passive scoped Ctrl/Command-wheel zoom 10–300%,
  current-sheet anchoring, rapid event accumulation, cleanup. Normal scroll unchanged.
- Mention scope controls compact/single-line with participant spacing, scoped only here.
- Calendar composer preview timestamps nowrap; narrow columns stack the label above.

No API, DB, office server or installed client changes. Other pending proposal/deadline
and calendar-space packages remain excluded. Local only: no push/merge authorized.
TEST web build ID: `localtest-20261016-message-file-calendar-controls`.
Regenerate release numbering before Docker build; recreate web only, then verify
HTTPS root/version and API readiness at `https://192.168.0.127:8443/`.

Checks: 9 focused attachment/PDF tests + 32 existing file/calendar regression tests
passed; typecheck, lint, release-note validation and 15 workflow tests passed.
Read-only Edge browser smoke passed in both themes: actual keyboard send/newline/
explicit Close, native Ctrl-wheel vs ordinary scroll, calendar at 1366/1024/720/390,
28 px mention tabs with no text overflow and 8 px participant gap. Screenshots/report
in ignored `tmp/message-file-controls-qa/`; no messages submitted to a live API.
Design changes follow existing scoped selectors, semantic colours and native focus.

Deployed TEST web `2.0.042`, build ID above, built at
`2026-10-16T13:32:51.690Z`, source `71412f99da3884a2fe7e82b0bcdf1adf3e6e9d9d`.
Production web build passed. HTTPS root/version checked through the gateway;
web healthy, API `0.23.0` ready; only web recreated. Previous image:
`sha256:1e8a9944695c98e3c53f88d87fa0d7e8a3c2890fe595c7748e97c858ea3307c2`.
QA Vite 5178 stopped after confirming its exact process. Browser QA is synthetic,
not an installed-Electron or real-account delivery check.

Next: collect owner feedback. Keep local; do not push/merge without authorization.
