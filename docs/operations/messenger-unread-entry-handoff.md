# Messenger entry position and composer — 19 October 2026

Source branch `fix/messenger-unread-entry-composer`, continuing source7e65d89d.
Scoped renderer fix; no contract, API, migration or account mutation.

The mini conversation stays mounted while the chat list hides it with display:none.
Previously its initial scroll was consumed before it had visible geometry. The
arrival hook now waits for an active, sized pane (including full-page portal bounds),
captures opening unread before mark-read clears it, and positions once per entry.
The current server marks all chat receipts atomically and bootstrap returns the
complete chronological visible history: the last N nondeleted incoming messages
are unread; own messages do not consume the counter. If pagination or partial
receipt reads are introduced, replace this calculation with a server unread cursor.
Do not reuse recipient read checks (they describe reads of the author's messages).

Read chats open at latest. Refresh/read acknowledgement do not yank a reader;
incoming messages respect follow-latest, own sends still follow. Hidden/revealed
chat-list entry resets; temporary hiding does not reset the cursor. Mini/full
expansion captures the visible row ID/offset before reflow and restores it after
destination bounds are measured, rather than reusing an incompatible pixel offset.
ResizeObserver only retries pending entry geometry, not every arrival/resize.

Composer focus uses a single real gradient border, no purple outline or extra
overlay. Forced colors retain Highlight outline. Mini first row gives only38px
to Send with6px gap, while the second row keeps five equal-width tools.

Validation:12 browser combinations (light/dark ×1440/390/320 ×mini/full)
passed first-unread positioning, mark-read stability,6px send gap, satin focus,
history editing, chat reentry and row-anchored expansion. Additional check passed
expanding from the chat list without selecting a chat, plus forced-color focus.
Existing accessibility suite passed keyboard/Escape/return focus,200% zoom,
320px width/480px height, reduced motion and forced colors in both themes.
Full desktop lint and changed-source lint passed. The120-test combined run had
117 passes:two animation tests needed a realistic clientHeight alongside their
existing visible-rect stub; one group-admin test exceeded its timing under load.
All three passed their final focused rerun (no timeout/expectation weakened).

Final TypeScript check passed; existing mini smoke passed8 theme/viewport cases,
covering drag/persisted position, one editor node, draft/files across expansion,
send/error/retry, forwarding dialog, navigation, unread and reduced motion. The
first broad smoke attempt timed out under load; its unchanged rerun completed.

Final hook/shell unit run:15/15 passed (10 entry/arrival,5 floating shell), plus
the final3/3 MessengerView regression tests described above. Local checks only;
no push/PR/merge/CI or installed EXE validation is implied.

Next: preserve unrelated
changes, cherry-pick only this patch onto TEST compatibilityd318a02e, build and
replace web only, verify version/readiness/non-web IDs/data counts. Never merge
the TEST compatibility branch into main. Office server and installed EXE out of scope.
