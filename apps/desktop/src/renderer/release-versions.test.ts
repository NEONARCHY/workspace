import { describe, expect, it } from "vitest";

import { compareReleaseVersions } from "./release-versions.mts";

describe("release version ordering", () => {
  it("sorts numeric version segments instead of comparing version strings", () => {
    const versions = ["1.0.2", "1.0.18", "1.0.9", "1.0.10", "1.0.100", "1.1.0"];
    expect(versions.sort((left, right) => compareReleaseVersions(right, left))).toEqual([
      "1.1.0",
      "1.0.100",
      "1.0.18",
      "1.0.10",
      "1.0.9",
      "1.0.2",
    ]);
  });

  it("places stable releases after their prereleases", () => {
    expect(compareReleaseVersions("1.0.18", "1.0.18-beta.2")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.0.18-beta.10", "1.0.18-beta.2")).toBeGreaterThan(0);
  });
});
