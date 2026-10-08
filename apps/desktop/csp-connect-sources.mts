const localSources = [
  "'self'",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:8080",
  "ws://127.0.0.1:8000",
  "ws://127.0.0.1:8080",
];

export function cspConnectSources(mode: string, publicOrigin?: string, lanOrigin?: string): string {
  // The production web server adds its own host-specific CSP header. Its meta
  // policy must not inadvertently block a same-host WebSocket connection.
  if (mode === "web") return [...localSources, "wss:"].join(" ");

  const sources = new Set(localSources);
  for (const origin of [publicOrigin, lanOrigin]) {
    if (!origin) continue;
    const parsed = new URL(origin);
    const localHttp = mode !== "production" && parsed.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.origin !== origin || (!localHttp && parsed.protocol !== "https:")) {
      throw new Error("Desktop API addresses must be exact HTTPS origins.");
    }
    sources.add(origin);
    sources.add(`${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`);
  }
  return [...sources].join(" ");
}
