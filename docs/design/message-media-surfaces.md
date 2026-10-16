# Message media surfaces

## Recorder and composer surfaces — 16 October 2026

Microphone permission/device negotiation has no transient connection banner;
the same composer remains mounted and usable until MediaRecorder starts. The
swap to the recorder happens before paint, including error/retry states. Typing
or Escape cancels a pending request; a late stream is stopped without recording.
Repeated mic clicks never create parallel requests. Actual failures still
explain the problem and offer retry/cancel. Browser permission is still required;
no permission bypass, pre-recording, auto-upload or artificial start delay exists.
Stream/context cleanup also runs on setup failures.

While recording, the existing microphone analyser appends measured amplitudes to
a left-to-right SVG path every 90 ms. The path contains at most 120 visible bars
(a trailing 10.8-second window); it never rebuilds chat history per sample. Stop,
cancel and unmount release the analyser/RAF/stream. The ready preview keeps the
existing recorded-sample waveform. Narrow conversation panes move the live track
below the timer and explicit stop/cancel controls.

The live track and ready preview now share a fixed 40 px row (48 px for coarse
pointers/mobile controls), matching the former recording height. The preview's
54 px minimum/padding no longer enlarges the composer after stop. The preview uses
one centered row without a duplicate time label; desktop Play is a 32 px circle
(48 px coarse/mobile target). The status time below “Запись готова” shows remaining
audio time during playback/seek, holds on pause and resets to full duration after
end. Sending always uses the original full recording duration. Only recorder preview is changed, not received
voice messages. Both states use the same narrow-pane row arrangement, with two
stable action columns below the track at <=520 px. Long labels may ellipsize there
but keep their complete accessible names. Error explanations and the volume
popover are not cropped or hidden to force the normal-state height.

Attach, calendar, mention, microphone and rewrite tools share one surface role:
the former microphone neutral fill in light mode, the paperclip's shared button
surface in dark mode. Hover/pressed roles, disabled text, microphone guard tooltip
and native forced-colour/focus states remain separate.

## Compact bubble footers and voice — 16 October 2026

Document captions get an 8 px gap before file rows. The final size line contains
the timestamp, wrapping the longer edited label when necessary, so captions no longer
force an empty footer below the file. Mention-only text messages use a wrapping
footer containing chips and time, without a separate metadata row.

Voice playback uses the bubble itself, a circular 44 px play button, waveform,
speed and volume controls. Duration/elapsed time, size and message metadata share
the lower line and wrap at narrow widths. Forwarded recordings retain the original
author profile link in a single “Переслано от” line, without a nested card or the
generated voice placeholder. Audio remains lazy-loaded on explicit play; retry,
seek, speed, output-device and volume handling remain intact. The waveform remains
the existing deterministic visual approximation, not newly decoded audio samples.

Dark message bubbles have no decorative border or inset satin highlight. Keyboard
focus, search/selection feedback and system forced-colour boundaries remain
separate. Curved 20 px tails overlap the rounded final group corners on each side;
standalone photos/conferences still suppress painted tails. Arrival/send animations
and their timing are unchanged.

## Composer isolation — 15 October 2026

Draft keystrokes reuse the memoized message-history subtree. Message data, permissions,
reactions, search, arrival/removal states and action callbacks still invalidate it.
The existing arrival/FLIP/send animations and timing are unchanged; draft edits no
longer rebuild rich attachment/avatar/reaction trees. This removes avoidable React
work, not a guarantee of a fixed frame rate on every device.

The microphone retains its normal surface while recording is unavailable. It remains
keyboard-focusable with aria-disabled and a guarded click handler. Hover/focus shows
a cross and a descriptive tooltip explaining text, attachments, editing or busy state.

## Stable photo albums and confirmation — 15 October 2026

Consecutive image attachments form justified tile albums of up to ten photos.
Order is preserved; rows depend on count and aspect ratios. Larger selections
split into multiple albums. Only previews are cropped to tile bounds: upload
bodies and downloaded originals remain byte-for-byte unchanged. The existing
fullscreen chat gallery still opens each individual original.

The fullscreen viewer only announces/shows its loading spinner after 400 ms.
Fast network/cache reads never flash the indicator. Selecting another image or
retrying restarts the delay; completing, failing or closing cancels its timer.
Errors and retry remain immediate, independent of this presentation delay.

`WorkspaceAttachment.imageWidth/imageHeight` reserve geometry before network
or decoding. Raster dimensions come from server-side header/EXIF parsing in a
thread, never from an untrusted client claim. Migration 0098 adds two nullable
columns; no existing file is rewritten or decoded in a bulk backfill. Legacy
photos use a stable 4:3 frame on first encounter and remember decoded dimensions
for future mounts. The current frame never changes during loading. Images load
near the viewport once and remain mounted when scrolled out; polling the same
attachment identity does not reload them. Videos retain their separate lifecycle.

Picking, pasting or dropping files opens a central confirmation dialog. Photos
get a tile preview; other files retain names/sizes and removal controls. Users
can add files, remove individual ones, edit the caption and explicitly send.
Returning to the chat preserves draft/files; it never uploads automatically.
Permissions, size validation, send ordering and failure recovery remain active.

An explicit IndexedDB cache stores original image blobs locally per server and
employee (no bearer tokens or third-party CDN). Lifetime is 30 days from storage,
not extended on reads; cleanup runs on use, app entry/foreground and hourly.
Disk cap is 256 MiB across scopes, memory cap 64 MiB; oldest copies can disappear
earlier at capacity or browser storage pressure. Logout clears that employee's
copies. Cache misses/quota/private-mode failures fall back to authenticated
downloads. Only attachments present in the current authorized workspace can be
requested by UI; the cache is not a general offline file browser and cannot
revoke copies already saved by a user. Raw HTTP downloads retain no-store.

Renderer files: `AttachmentImage`, `image-album-layout`, `attachment-image-cache`,
`MessageAttachmentsDialog`. No second UI kit, image compression on send, or
per-frame React animation is introduced.

Images in messenger conversations use the image itself as the message surface:
no duplicate file footer or outer bubble padding. Natural proportions are kept,
bounded to 360 px wide / 420 px tall and the available conversation width.
Real captions remain below images; the generated `Файл` placeholder is omitted.
Uncaptioned image timestamps sit over the lower right image corner. Sender,
reply, mentions, reactions, keyboard/context actions and the existing image
viewer remain available. Ordinary files, mixed attachments, voice, videos and
forwarded content keep their existing presentation. Other attachment panels
do not opt into this messenger-only presentation.

Zoom invitations are standalone cards without a second coloured bubble. Their
width matches the message; timestamps occupy reserved space at the card bottom,
clear of the participant disclosure and meeting actions.

Text bubbles get a curved tail only at the end of a sender group. Its fill
overlaps the rounded lower corner to avoid a transparent seam; incoming tails
are mirrored on the left. Forced-colour mode does not use these painted tails.

Employee profile identity photos are 128 px, or 96 px in narrow dialogs.
The avatar API already preserves up to 1024 px with Lanczos downsampling and
lossless PNG storage. No blur or synthetic detail filter is applied: small
original images require a better source rather than invented facial detail.

## File rows and reaction affordance

Shared attachment chips present documents as a 44px circular file icon beside
the filename and size on separate lines. The whole row remains one native
button with its existing open/download callback; long names truncate visually
but remain complete in the accessible name and tooltip. Messenger file rows
use the bubble itself as their surface, without nested file borders. Image
media, audio players and attachment deletion keep their separate controls.
File-only messages without captions place their timestamp beside the final
file's size, reserving inline space so neither overlaps. The attachment list
has no extra top margin; document rows are 44px high inside 8px bubble insets.
Real captions use the same wrapping size-line metadata without covering file content.

Mouse/pen reaction affordances appear after 500ms within a message. Leaving
early, switching messages or unmounting cancels the pending timer. Keyboard
focus exposes actions immediately; coarse/touch layouts retain their existing
visible controls. The reaction button has a plain circular fill and border,
no decorative pseudo-border; an explicit focus-visible outline remains.
