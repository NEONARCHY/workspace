# Reaction artwork

## Animated Noto Emoji by Google

115 reactions use [Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-files/),
copyright Google, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Full license: `/licenses/Noto-Animated-Emoji-CC-BY-4.0.txt`.
These are Google artwork, not Apple/iOS or Telegram assets.

Adaptations: resized from 512 to 64 px using Lanczos, preserving every native frame and its original timing,
encoded as lossy animated WebP (quality 78), full loop duration preserved,
infinite looping; lossless first-frame WebP supplied for reduced motion/offscreen.
Frozen sources, original SHA-256 hashes and local output metadata are in
`noto/manifest.json`. Fetch/prepare: `python scripts/prepare-animated-reactions.py`
(Python 3.11 + Pillow). Source URL `latest` is not used by the running app;
updating assets is an explicit preparation step and records new hashes.
Five unavailable animations retain static Twemoji; Unicode values/API are unchanged.

## Static fallback: Twemoji

Unmodified SVG artwork from [Twemoji 16.0.1](https://github.com/jdecked/twemoji/tree/v16.0.1/assets/svg),
copyright Twitter, Inc. and other contributors, maintained by jdecked/twemoji.
Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The complete license is shipped in `/licenses/Twemoji-CC-BY-4.0.txt`.

Only the 120 server-accepted reactions are bundled. Assets load from the application's
own origin, without a CDN or third-party runtime requests. These are not Apple assets.
