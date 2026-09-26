import { useId, type ReactNode } from "react";

function BadgeGlyph({ iconKey }: { readonly iconKey: string }): ReactNode {
  switch (iconKey) {
    case "check":
    case "target":
      return <><circle cx="32" cy="32" r="13" /><circle cx="32" cy="32" r="5" /><path d="m24 32 5 5 11-12" /></>;
    case "layers":
      return <><path d="m18 25 14-8 14 8-14 8-14-8Z" /><path d="m19 33 13 8 13-8M22 40l10 6 10-6" /></>;
    case "compass":
      return <><circle cx="32" cy="32" r="15" /><path d="m38 24-4 11-10 5 4-11 10-5Z" /><circle cx="32" cy="32" r="2" /></>;
    case "signal":
      return <><path d="M21 42V34M32 42V27M43 42V20" /><path d="M19 25c7-7 19-9 27-3" /><circle cx="46" cy="22" r="2" /></>;
    case "spark":
    case "appreciation":
      return <><path d="M32 45S19 38 19 28c0-5 6-8 10-4l3 3 3-3c4-4 10-1 10 4 0 10-13 17-13 17Z" /><path d="m42 17 1.5 3.5L47 22l-3.5 1.5L42 27l-1.5-3.5L37 22l3.5-1.5L42 17Z" /></>;
    case "pulse":
    case "reliability":
      return <><path d="M32 16 45 21v10c0 8-5 14-13 18-8-4-13-10-13-18V21l13-5Z" /><path d="M22 33h6l3-7 4 13 3-6h5" /></>;
    case "orbit":
      return <><ellipse cx="32" cy="32" rx="17" ry="8" transform="rotate(-24 32 32)" /><ellipse cx="32" cy="32" rx="17" ry="8" transform="rotate(36 32 32)" /><circle cx="32" cy="32" r="4" /><circle className="recognition-glyph-solid" cx="45" cy="22" r="3" /></>;
    case "gem":
      return <><path d="m18 26 7-9h14l7 9-14 22-14-22Z" /><path d="m18 26 14 7 14-7M25 17l7 16 7-16M32 33v15" /></>;
    case "camera":
      return <><rect x="17" y="22" width="27" height="21" rx="6" /><path d="m44 29 7-4v15l-7-4V29Z" /><circle cx="30.5" cy="32.5" r="5" /><path d="M22 19h10" /></>;
    case "mail":
      return <><rect x="15" y="20" width="34" height="25" rx="6" /><path d="m18 24 14 11 14-11" /><circle className="recognition-glyph-solid" cx="45" cy="42" r="5" /><path className="recognition-glyph-cut" d="m42.5 42 1.6 1.7 3.2-3.5" /></>;
    case "megaphone":
      return <><path d="m17 31 25-10v22L17 34v-3Z" /><path d="M22 36v9h8l-3-7M45 27l4-3M46 33h5M45 39l4 3" /></>;
    case "receipt":
      return <><path d="M21 16h22v33l-4-3-4 3-4-3-4 3-3-3-3 3V16Z" /><path d="M27 25h10M27 32h10M27 39h6" /></>;
    case "leadership":
      return <><path d="m18 26 8 6 6-14 6 14 8-6-3 18H21l-3-18Z" /><path d="M22 40h20" /><circle className="recognition-glyph-solid" cx="18" cy="23" r="2" /><circle className="recognition-glyph-solid" cx="32" cy="15" r="2" /><circle className="recognition-glyph-solid" cx="46" cy="23" r="2" /></>;
    case "rescue":
      return <path d="M35 14 20 35h11l-3 15 16-23H33l2-13Z" />;
    case "mentorship":
      return <><circle cx="25" cy="27" r="6" /><circle cx="40" cy="24" r="5" /><path d="M15 46c1-9 6-13 12-13s11 4 12 13M36 33c7 0 11 4 12 11" /><path d="m39 36 3 3 6-7" /></>;
    case "innovation":
      return <><path d="M22 29c0-7 4-12 10-12s10 5 10 12c0 5-4 7-5 11H27c-1-4-5-6-5-11Z" /><path d="M27 44h10M29 49h6M32 11V7M17 17l-3-3M47 17l3-3" /></>;
    default:
      return <path d="m32 16 4.8 9.7 10.7 1.6-7.7 7.5 1.8 10.6L32 40.3l-9.6 5.1 1.8-10.6-7.7-7.5 10.7-1.6L32 16Z" />;
  }
}

export function RecognitionBadgeArtwork({ iconKey }: { readonly iconKey: string }) {
  const gradientId = `recognition-badge-${useId().replace(/:/g, "")}`;
  return <svg className="recognition-badge-artwork" viewBox="0 0 64 64" focusable="false" aria-hidden="true">
    <defs>
      <linearGradient id={gradientId} x1="14" y1="10" x2="52" y2="56" gradientUnits="userSpaceOnUse">
        <stop offset="0" className="recognition-badge-stop-highlight" />
        <stop offset="0.5" className="recognition-badge-stop-main" />
        <stop offset="1" className="recognition-badge-stop-shadow" />
      </linearGradient>
    </defs>
    <path className="recognition-badge-depth" d="M32 5 52 15v28L32 59 12 43V15L32 5Z" />
    <path className="recognition-badge-rim" d="M32 3 52 14v27L32 57 12 41V14L32 3Z" fill={`url(#${gradientId})`} />
    <path className="recognition-badge-face" d="M32 9 47 17v21L32 50 17 38V17L32 9Z" />
    <path className="recognition-badge-facet" d="M17 17 32 9l15 8-15 5-15-5Zm0 21 15 12 15-12-15 5-15-5Z" />
    <g className="recognition-badge-glyph"><BadgeGlyph iconKey={iconKey} /></g>
    <path className="recognition-badge-shine" d="M18 17 32 9l9 5-18 8-5-5Z" />
  </svg>;
}
