import { describe, expect, it } from "vitest";
import { crossedMessageBands, shouldStartMessagePaint } from "./useMessagePaintSelection";

describe("paint selection activation", () => {
  it("ignores small pointer motion and starts at 20px without a hold timer", () => {
    expect(shouldStartMessagePaint(0, 0, false)).toBe(false);
    expect(shouldStartMessagePaint(19, 0, false)).toBe(false);
    expect(shouldStartMessagePaint(0, 19, false)).toBe(false);
    expect(shouldStartMessagePaint(20, 0, false)).toBe(true);
    expect(shouldStartMessagePaint(0, 20, false)).toBe(true);
    expect(shouldStartMessagePaint(12, 16, false)).toBe(true);
  });
  it("preserves native horizontal text selection and starts vertical painting promptly", () => {
    expect(shouldStartMessagePaint(100, 0, true)).toBe(false);
    expect(shouldStartMessagePaint(3, 1, true)).toBe(false);
    expect(shouldStartMessagePaint(100, 19, true)).toBe(false);
    expect(shouldStartMessagePaint(0, 20, true)).toBe(true);
  });
});

const bands = [
  { id: "a", top: 10, bottom: 30 },
  { id: "b", top: 40, bottom: 60 },
  { id: "c", top: 70, bottom: 90 },
];
describe("paint selection crossings", () => {
  it("includes skipped rows in travel order", () => {
    expect(crossedMessageBands(bands, 0, 95)).toEqual({ ids: ["a", "b", "c"], current: undefined });
    expect(crossedMessageBands(bands, 95, 0).ids).toEqual(["c", "b", "a"]);
  });
  it("does not toggle repeatedly while staying in a row", () => {
    expect(crossedMessageBands(bands, 15, 20, "a")).toEqual({ ids: [], current: "a" });
    expect(crossedMessageBands(bands, 20, 20, "a").ids).toEqual([]);
  });
  it("toggles again on reverse re-entry, but not the turnaround row", () => {
    expect(crossedMessageBands(bands, 15, 75, "a").ids).toEqual(["b", "c"]);
    expect(crossedMessageBands(bands, 75, 15, "c").ids).toEqual(["b", "a"]);
  });
  it("allows leaving into a gap and re-entering the same row", () => {
    expect(crossedMessageBands(bands, 20, 35, "a")).toEqual({ ids: [], current: undefined });
    expect(crossedMessageBands(bands, 35, 20).ids).toEqual(["a"]);
  });
  it("includes the initial row and uses half-open row boundaries", () => {
    expect(crossedMessageBands(bands, 15, 25).ids).toEqual(["a"]);
    expect(crossedMessageBands(bands, 30, 40)).toEqual({ ids: ["b"], current: "b" });
  });
});
