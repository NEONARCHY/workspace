import { describe, expect, it } from "vitest";

import { compareDesktopVersions, requiresDesktopUpdate } from "./desktop-updates";

describe("mandatory desktop versions", () => {
  it("compares each numeric component rather than lexicographic text", () => {
    expect(compareDesktopVersions("0.29.0", "0.30.0")).toBe(-1);
    expect(compareDesktopVersions("0.30.0", "0.30.0")).toBe(0);
    expect(compareDesktopVersions("1.10.0", "1.9.9")).toBe(1);
  });

  it("blocks only an installed version below the mandatory minimum", () => {
    const policy = {
      publishedVersion: "0.31.0", minimumVersion: "0.30.0", mandatory: true,
      updatedAt: null, release: null,
    };
    expect(requiresDesktopUpdate(policy, "0.29.0")).toBe(true);
    expect(requiresDesktopUpdate(policy, "0.30.0")).toBe(false);
    expect(requiresDesktopUpdate({ ...policy, mandatory: false }, "0.29.0")).toBe(false);
    expect(requiresDesktopUpdate(policy, undefined)).toBe(false);
  });
});
