import { describe, expect, it } from "vitest";

import { compareReleaseVersions, nextUpdateVersion, numberUpdateNotes } from "./release-versions.mts";

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

  it("numbers test updates through 999, then starts the next minor version", () => {
    expect(nextUpdateVersion("1.0.18")).toBe("1.0.19");
    expect(nextUpdateVersion("1.0.998")).toBe("1.0.999");
    expect(nextUpdateVersion("1.0.999")).toBe("1.1.0");
    expect(nextUpdateVersion("1.1.0")).toBe("1.1.1");
  });

  it("rejects invalid versions rather than silently reusing a number", () => {
    expect(() => nextUpdateVersion("1.0.1000")).toThrow("Invalid published version");
    expect(() => nextUpdateVersion("1.0.18-beta")).toThrow("Invalid published version");
  });

  it("keeps the same history after notes are archived or read in a different order", () => {
    const earlier = { id: "earlier", fileName: "20260927-earlier.json" };
    const later = { id: "later", fileName: "20260928-later.json" };
    expect(numberUpdateNotes([earlier, later], "1.0.17")).toEqual(numberUpdateNotes([later, earlier], "1.0.17"));
    expect(numberUpdateNotes([later, earlier], "1.0.17").map(({ id, version }) => [id, version])).toEqual([
      ["later", "1.0.19"], ["earlier", "1.0.18"],
    ]);
  });

  it("does not allow duplicate note IDs to produce ambiguous versions", () => {
    const note = { id: "duplicate", fileName: "20260928-note.json" };
    expect(() => numberUpdateNotes([note, note], "1.0.17")).toThrow("must be unique");
  });
});
