# Approval counter spacing — local + TEST web

Branch `fix/approval-counter-spacing`, base `012879c1`, worktree `tmp/emoji-theme-polish`.
Payment/trip summaries now use four equal columns, symmetric 12 px outer padding
and equal cell gaps, preserving existing colours, first-action emphasis, numbers
and keyboard/filter behaviour. Compact workspace uses 2×2; browser mobile density
still owns its smaller padding. Trip's presentation-only metrics wrapper uses
display:contents so its three cells share the same grid as the action button.
Owner clarified vertical gaps between sections too: remove the header's extra
14 px bottom margin only on these two pages. Summary-to-header and summary-to-filter
controls now share a 12 px gap (8 px compact browser), instead of 24 vs 10 / 22 vs 6.
The toolbar's bottom padding uses the same token. Other section headers unchanged.
No API, database, office server or installed Electron changes. Other pending
local task/calendar packages remain excluded. No push/merge authorized.

Verified: 25 approval/trip tests; release-note validation and 15 workflow tests.
Read-only Edge fixture uses actual ApprovalsView/TripApprovalsView + complete CSS;
16 geometry checks across both themes at 1440/1024/720/390, equal cell widths/heights,
equal outer padding, no clipped text, keyboard filter actions. Forced-colour/reduced
motion snapshot also inspected. The 16 cases additionally assert equal vertical
gaps above and below the summary (12 px desktop / 8 px compact browser). Full-page
screenshots show the actual header, summary and filters together. Forced-colour/reduced
motion snapshot also inspected. Artifacts: ignored `tmp/approval-counter-spacing-qa/`.
No live approvals submitted; installed Electron not tested.

Next: update TEST web only and record actual version/readiness.
Build ID `localtest-20261016-approval-counter-spacing`.
