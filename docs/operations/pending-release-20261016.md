# Complete pending chat release — 16 October 2026

Owner explicitly authorizes push, normal PR/green-CI/merge, and full TEST rollout
of all pending changes from this chat. Owner excludes old unrelated experiments
(workspace calls, abandoned orb/navigation variants). Office server and installed
Electron rollout are not authorized.

Included: calendar-space/day scrolling (`b319e0c6`); author-approved task proposals
and deadline decision inbox/work-first task card (`252b7d75`); deployed-but-unpushed
emoji/theme, task/report/map/feed, light incoming satin, attachment keyboard/PDF
wheel/mention/calendar timestamp and approval counter/section spacing (through
`8d4bdeb8`). Previously merged messenger synchronization/rich text/reactions remain.
Source snapshots retained in their original branches and working copies.

Integration branch `feature/pending-release-20261016` starts from the last TEST UI
package, then merges fresh `origin/main` (`c2d52e12`), proposals/deadlines, calendar.
Short-name and leave workflow changes already in main are preserved. Both independent
0101 migrations descend from 0100; additive `0102_merge_leave_task` joins both heads
without rewriting either applied migration. TEST currently 0100 requires both 0101s.

Next: run full checks with a fresh isolated QA database, review PR and green CI,
merge normally, rebuild from exact main. Back up TEST before migration, update API,
workers/scheduler if affected, web; verify HTTPS/version, API readiness and schema.
Never reset TEST volumes or print environment credentials. Deployment evidence pending.
