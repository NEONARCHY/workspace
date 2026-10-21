const scopes = new Set([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
]);

/** Only Google's mail consent page may leave the trusted Electron renderer. */
export function validatedGoogleMailLink(candidate: unknown, allowLocalhost = false): string | undefined {
  if (typeof candidate !== "string" || candidate.length > 8192) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.hostname !== "accounts.google.com" || url.port
      || url.username || url.password || url.hash || url.pathname !== "/o/oauth2/v2/auth") return undefined;
    for (const name of ["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method"]) {
      if (url.searchParams.getAll(name).length !== 1) return undefined;
    }
    if (url.searchParams.get("response_type") !== "code" || url.searchParams.get("code_challenge_method") !== "S256"
      || !/^[A-Za-z0-9._-]{5,300}$/.test(url.searchParams.get("client_id") ?? "")
      || !/^[A-Za-z0-9_-]{20,200}$/.test(url.searchParams.get("state") ?? "")
      || !/^[A-Za-z0-9_-]{43,128}$/.test(url.searchParams.get("code_challenge") ?? "")) return undefined;
    const requested = new Set((url.searchParams.get("scope") ?? "").split(" ").filter(Boolean));
    if (requested.size !== scopes.size || [...requested].some(scope => !scopes.has(scope))) return undefined;
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
    if (redirect.username || redirect.password || redirect.hash || redirect.search
      || !redirect.pathname.endsWith("/mail/oauth/callback")) return undefined;
    if (!(allowLocalhost && redirect.hostname === "localhost" && ["http:", "https:"].includes(redirect.protocol))
      && (redirect.protocol !== "https:" || !redirect.hostname.includes(".")
        || /^[\d.]+$/.test(redirect.hostname) || redirect.hostname.includes(":"))) return undefined;
    return url.href;
  } catch { return undefined; }
}
