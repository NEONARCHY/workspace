export const desktopConnectSourcesToken = "__YUKSALISH_DESKTOP_CONNECT_SOURCES__";

interface ConnectOrigins {
  readonly lan?: string;
  readonly public?: string;
}

function validatedHttpsOrigin(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password) {
    throw new Error("Desktop API origins in the CSP must be exact HTTPS origins.");
  }
  return parsed;
}

export function desktopConnectSources(mode: string, origins: ConnectOrigins): string {
  if (mode === "web" || mode === "development") return "";
  const sources = new Set<string>();
  for (const value of [origins.lan, origins.public]) {
    if (!value) continue;
    const origin = validatedHttpsOrigin(value);
    sources.add(origin.origin);
    sources.add(`wss://${origin.host}`);
  }
  return [...sources].join(" ");
}

export function injectDesktopConnectSources(html: string, mode: string, origins: ConnectOrigins): string {
  if (!html.includes(desktopConnectSourcesToken)
    || html.indexOf(desktopConnectSourcesToken) !== html.lastIndexOf(desktopConnectSourcesToken)) {
    throw new Error("Renderer CSP must contain exactly one desktop connect-sources marker.");
  }
  return html.replace(desktopConnectSourcesToken, desktopConnectSources(mode, origins));
}
