# Notification sound and quiet login — 14 October 2026

The NotificationCenter sound area separates the enable switch, labelled volume
range, explicit Save/Preview actions and system-delivery test. Help is an optional
native disclosure rather than a large tinted block. Native range keyboard/touch
interaction remains intact. A red/amber/green track shows the selected amount;
its thumb responds with a bounded 160 ms scale, without scaling text, layout
animation, animated shadow or per-frame React work. Reduced motion disables
thumb movement; forced colours retain system controls/focus. Both themes use
existing surface/text tokens.

The renderer fallback, API schema and newly created preference rows default to
100%. Migration `0094_notification_volume_default` changes the database insert
default only: existing saved volumes, including 20%, and sound-disabled choices
are preserved. Apply the migration and deploy the API for new users to receive
the same default server-side; a frontend-only deployment cannot change saved
server preferences.

After login only the chronologically latest valid, non-obsolete event is eligible
for a native banner. If already read or delivered, older events do not replay
instead. Hisobot uses this same one-event slot, with its reporting-window expiry
unchanged. Reconnection batches also consume all IDs but attempt only their
latest event. Muted channels remain muted; no notification is deleted or marked
read. A per-employee bounded local ID list and browser lock suppress duplicate
successful native delivery across reloads/tabs if the server acknowledgement
fails. The server delivery acknowledgement still handles other devices.

Loaded notification history remains silent. Newly received sound batches play
only their latest fresh unread event; existing cross-tab sound deduplication,
autoplay restrictions and 2.5 s rate limit are retained.
