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

  it("keeps existing numbers when an earlier-dated PR is merged later", () => {
    const old = { id: "old", fileName: "20261005-old.json" };
    const a = { id: "a", fileName: "20261002-a.json" };
    const b = { id: "b", fileName: "20261007-b.json" };
    const before = numberUpdateNotes([old, b], "1.0.17", [old.fileName, b.fileName]);
    const after = numberUpdateNotes([a, b, old], "1.0.17", [old.fileName, b.fileName, a.fileName]);
    expect(after.map(({ id, version }) => [id, version])).toEqual([
      ["a", "1.0.20"], ["b", "1.0.19"], ["old", "1.0.18"],
    ]);
    expect(after.slice(1)).toEqual(before);
    expect(numberUpdateNotes([b, a, old], "1.0.17", [old.fileName, a.fileName, b.fileName])[0]?.id).toBe("b");
  });

  it("rejects incomplete or ambiguous explicit ordering", () => {
    const note = { id: "a", fileName: "a.json" };
    expect(() => numberUpdateNotes([note], "1.0.17", [])).toThrow("complete and unique");
    expect(() => numberUpdateNotes([note], "1.0.17", ["a.json", "a.json"])).toThrow("complete and unique");
    expect(() => numberUpdateNotes([note, { ...note, id: "b" }], "1.0.17", ["a.json"])).toThrow("filenames must be unique");
  });
});
