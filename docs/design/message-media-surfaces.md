# Message media surfaces

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
overlaps the square lower corner to avoid a transparent seam; incoming tails
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
Real captions retain a normal metadata footer instead of covering file content.

Mouse/pen reaction affordances appear after 500ms within a message. Leaving
early, switching messages or unmounting cancels the pending timer. Keyboard
focus exposes actions immediately; coarse/touch layouts retain their existing
visible controls. The reaction button has a plain circular fill and border,
no decorative pseudo-border; an explicit focus-visible outline remains.
