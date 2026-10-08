import { describe, expect, it } from "vitest";

import { cspConnectSources } from "../../csp-connect-sources.mts";

describe("desktop connection security policy", () => {
  it("allows only the configured LAN and public HTTPS/WSS origins", () => {
    const policy = cspConnectSources(
      "production", "https://workspace.opinions.uz", "https://192.168.0.119:8443",
    );
    expect(policy).toContain("https://workspace.opinions.uz");
    expect(policy).toContain("wss://workspace.opinions.uz");
    expect(policy).toContain("https://192.168.0.119:8443");
    expect(policy).toContain("wss://192.168.0.119:8443");
    expect(policy.split(" ")).not.toContain("https:");
    expect(policy.split(" ")).not.toContain("wss:");
    expect(policy).not.toContain("unrelated.example");
  });

  it("rejects insecure or non-origin release addresses", () => {
    expect(() => cspConnectSources("production", "http://workspace.opinions.uz"))
      .toThrow("exact HTTPS origins");
    expect(() => cspConnectSources("production", "https://workspace.opinions.uz/api/v1"))
      .toThrow("exact HTTPS origins");
  });

  it("keeps the web meta policy compatible with the host-specific server header", () => {
    expect(cspConnectSources("web")).toContain("wss:");
    expect(cspConnectSources("web")).not.toContain("https://workspace.opinions.uz");
  });
});
