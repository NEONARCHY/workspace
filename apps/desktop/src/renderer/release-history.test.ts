import { describe, expect, it } from "vitest";
import { bundledReleaseEntries, latestReadReleaseVersion, orderedReleaseEntries, unreadReleaseEntries, type ReleaseTimelineEntry } from "./release-history";

const entry = (id: string, version: string): ReleaseTimelineEntry => ({ id, version, title: version, items: [id] });

describe("account release history", () => {
  it("sorts numerical versions without mutating input and rejects invalid versions / duplicate IDs", () => {
    const entries = [entry("a", "2.0.9"), entry("b", "2.0.10"), entry("b", "2.0.99"), entry("x", "invalid")];
    expect(orderedReleaseEntries(entries).map(value => value.id)).toEqual(["b", "a"]);
    expect(entries[0]?.version).toBe("2.0.9");
  });
  it("tracks stable entry IDs, not build IDs or potentially renumbered versions", () => {
    const entries = [entry("update:new", "2.0.11"), entry("update:known", "2.0.10")];
    expect(unreadReleaseEntries(entries, ["update:known", "update:future"])).toEqual([entries[0]]);
    expect(latestReadReleaseVersion(entries, ["update:known"])).toBe("2.0.10");
    expect(latestReadReleaseVersion(entries, [])).toBeUndefined();
  });
  it("does not truncate the consolidated history or invent previous receipts", () => {
    const entries = bundledReleaseEntries();
    expect(unreadReleaseEntries(entries, [])).toEqual(entries);
    expect(entries.some(value => value.items.length > 50)).toBe(true);
    expect(entries.some(value => value.version === "1.0.0")).toBe(true);
    expect(new Set(entries.map(value => value.id)).size).toBe(entries.length);
    expect(entries.every(value => /^(?:update|release):[A-Za-z0-9._-]+$/.test(value.id) && value.id.length <= 220)).toBe(true);
  });
});
