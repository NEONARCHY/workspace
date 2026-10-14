/** This capability opens Zoom meeting HTTPS links, never arbitrary navigation. */
export function validatedZoomLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048
    || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trusted = ["zoom.us", "zoom.com", "zoomgov.com"].some(domain => host === domain || host.endsWith(`.${domain}`));
    return url.protocol === "https:" && trusted && !url.username && !url.password
      && (!url.port || url.port === "443") && /^\/(?:j\/\d{9,11}|wc\/(?:join|j)\/\d{9,11})\/?$/.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}
