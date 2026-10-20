import { describe, expect, it } from "vitest";
import { balanceTests, testWeight } from "../../vitest.balanced-shards.mts";
import timings from "../../ci-test-timings.json";

describe("duration-balanced CI shards", () => {
  const files = Array.from({ length: 25 }, (_, file) => ({ file, key: `test-${file}`, duration: file + 1 }));
  it("runs every discovered file exactly once, including unknown and renamed files", () => {
    const shards = balanceTests(files, 4);
    expect(shards.flat().sort((a, b) => a - b)).toEqual(files.map((entry) => entry.file));
    expect(new Set(shards.flat()).size).toBe(files.length);
    expect(testWeight("ui", "src/new.test.tsx")).toBeGreaterThan(0);
    expect(testWeight("node", "src/renamed.test.ts")).toBeGreaterThan(0);
  });
  it("is deterministic regardless of discovery order and does not mutate input", () => {
    const original = [...files];
    expect(balanceTests([...files].reverse(), 4)).toEqual(balanceTests(files, 4));
    expect(files).toEqual(original);
  });
  it("handles small and empty sets, single shards and invalid weights", () => {
    expect(balanceTests([], 4)).toEqual([[], [], [], []]);
    expect(balanceTests(files.slice(0, 2), 4).flat()).toHaveLength(2);
    expect(balanceTests(files, 1).flat()).toHaveLength(25);
    expect(() => balanceTests(files, 0)).toThrow();
    expect(() => balanceTests([{ file: 1, key: "a", duration: NaN }], 4)).toThrow();
  });
  it("normalizes Windows paths and balances the measured CI workload", () => {
    expect(testWeight("ui", "src\\renderer\\App.tasks.test.tsx")).toBe(testWeight("ui", "src/renderer/App.tasks.test.tsx"));
    const measured = Object.entries(timings.durationsMs).map(([key, duration]) => ({ key, duration, file: key }));
    const totals = balanceTests(measured, 4).map((shard) => shard.reduce((sum, key) => sum + timings.durationsMs[key as keyof typeof timings.durationsMs], 0));
    expect(Math.max(...totals) / Math.min(...totals)).toBeLessThan(1.05);
    const shards = balanceTests(measured, 4);
    expect(shards.findIndex((shard) => shard.includes("ui:src/renderer/App.tasks.test.tsx")))
      .not.toBe(shards.findIndex((shard) => shard.includes("ui:src/renderer/App.shell.test.tsx")));
  });
});
