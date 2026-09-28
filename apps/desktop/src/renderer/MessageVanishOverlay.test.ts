import { describe, expect, it } from "vitest";
import {
  getMessageParticleTiming,
  wrapMessageParticleText,
} from "./MessageVanishOverlay";

describe("message particle transition", () => {
  it("scales the matching vanish and reveal timeline with message length", () => {
    const short = getMessageParticleTiming("Короткое сообщение");
    const long = getMessageParticleTiming("Длинное сообщение ".repeat(18));

    expect(long.sweepMs).toBeGreaterThan(short.sweepMs);
    expect(long.totalMs).toBeGreaterThan(short.totalMs);
    expect(getMessageParticleTiming("Очень длинное ".repeat(500)).sweepMs).toBe(1_100);
  });

  it("wraps an uninterrupted long word instead of clipping it", () => {
    const lines = wrapMessageParticleText(
      "оченьдлинныйтекстбезпробелов",
      42,
      (value) => Array.from(value).length * 7,
    );

    expect(lines.join("")).toBe("оченьдлинныйтекстбезпробелов");
    expect(lines).toHaveLength(5);
    expect(lines.every((line) => Array.from(line).length <= 6)).toBe(true);
  });
});
