# Light incoming filter satin — local + TEST web

Branch `fix/light-incoming-satin`, worktree `tmp/emoji-theme-polish`,
base `9938a4b3` (previous local TEST detail-layout package).

Only selected incoming-letter summary cards in light mode change: the previous
solid border + inset ring becomes a single tapered teal satin stroke painted in
the existing 1 px border. White/primary tint fills, layout, focus and forced-colour
behaviour are preserved; dark rules and unselected light cards are unchanged.
The RGB token exists only in dark mode, so light uses the official #006779 fallback.

Checks: 10 satin/theme-geometry tests passed; release-note validation and 15
workflow tests passed. Browser smoke on the real incoming registry + complete CSS
checks both themes, selection switching, identical dimensions, no inset ring and
forced colours. Screenshots/report: ignored `tmp/light-incoming-satin-qa/`.
No API/business logic, migrations or installed Electron changes.

Owner continues local/no-push mode with TEST updates. Build ID:
`localtest-20261016-light-incoming-satin`. Rebuild/recreate web only in
`yuksalish-localtest`, regenerate numbering first, verify HTTPS root/version/API
readiness. TEST: `https://192.168.0.127:8443/`.
Other pending local task/calendar work remains excluded.

Next: collect owner feedback; do not push/merge without authorization.
