# Messenger polish integration

User requested pushing and merging the completed conversation work on 2026-10-19.

- Source checkpoint: `feat/messenger-jump-latest`, `c4fba790`.
- Integration branch: `fix/messenger-polish-integration`.
- Integrated main checkpoint: `2a74d88c` (team signature inbox and travel/leave launch audit preserved).
- Scope: the 46 accumulated source commits since `2fccd82c`, including attachment forwarding, global mini Messenger, selection, unread navigation, and interface polish.
- TEST compatibility branches are not merge inputs. PR #88 is unrelated and remains untouched.

Release gate: release-note/workflow validation, desktop lint/type checking and focused integration tests locally; complete required GitHub CI and review before merging. The PR and its checks are the authoritative merge record.

PR: https://github.com/NEONARCHY/workspace/pull/217. Local typecheck/lint passed. The initial focused run passed 86/87 tests; its only failure was the obsolete App handoff test trying to click the intentionally hidden full-page launcher. Updated it to assert the launcher is absent, navigate to Tasks, reopen mini, and verify editor identity. No runtime behavior was relaxed.

Initial CI Python run: 1118 passed, 2 skipped, 1 adapter-fixture failure. Added the forwarding storage dependency to the thin-router test fixture and asserted it is passed to the forwarding service. Production storage wiring remains unchanged.

Deployment boundary: this is source integration only. TEST remains on its separately released compatible web build `localtest-20261019-jump-latest-7bf0b554` (2.0.074). Do not deploy main API or migrations onto the older TEST schema as part of this operation. Office server and installed desktop executables are not changed.
