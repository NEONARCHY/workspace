import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { desktopConnectSourcesToken, injectDesktopConnectSources } from "./csp-connect-sources.mts";

const template = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const origins = {
  lan: "https://192.168.0.119:8443",
  public: "https://workspace.opinions.uz",
};

describe("desktop renderer Content Security Policy", () => {
  it("permits only the configured HTTPS and WSS API origins in a desktop build", () => {
    const html = injectDesktopConnectSources(template, "production", origins);
    const connect = html.match(/connect-src ([^"]+)/)?.[1] ?? "";
    expect(connect).toContain(origins.lan);
    expect(connect).toContain("wss://192.168.0.119:8443");
    expect(connect).toContain(origins.public);
    expect(connect).toContain("wss://workspace.opinions.uz");
    expect(connect).not.toContain(desktopConnectSourcesToken);
  });

  it("keeps the browser build on its existing same-origin policy", () => {
    const html = injectDesktopConnectSources(template, "web", origins);
    expect(html).not.toContain(origins.lan);
    expect(html).not.toContain(origins.public);
  });

  it.each([
    "http://192.168.0.119:8443",
    "https://workspace.opinions.uz/path",
    "https://user:password@workspace.opinions.uz",
  ])("rejects non-exact or insecure origin %s", (origin) => {
    expect(() => injectDesktopConnectSources(template, "production", { public: origin })).toThrow();
  });

  it("fails when the CSP marker is missing", () => {
    expect(() => injectDesktopConnectSources("<html></html>", "production", origins)).toThrow();
  });
});
