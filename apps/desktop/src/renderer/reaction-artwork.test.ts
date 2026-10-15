import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../public/emoji/noto/manifest.json";

describe("frozen animated artwork", () => {
  it("ships bounded native loops with matching hashes and static alternatives", () => {
    let bytes = 0;
    for (const [code, entry] of Object.entries(manifest)) {
      if (!entry) continue;
      const animation = readFileSync(resolve("public/emoji/noto", `${code}.webp`));
      const still = readFileSync(resolve("public/emoji/noto", `${code}-still.webp`));
      expect(createHash("sha256").update(animation).digest("hex")).toBe(entry.sha256);
      expect(animation.length).toBe(entry.bytes);
      expect(animation.subarray(8, 12).toString()).toBe("WEBP");
      const loop = animation.indexOf(Buffer.from("ANIM"));
      expect(loop).toBeGreaterThan(0);
      expect(animation.readUInt16LE(loop + 12)).toBe(0); // infinite loop
      expect(still.indexOf(Buffer.from("ANIM"))).toBe(-1);
      expect(entry.frames * 1000 / entry.durationMs).toBeLessThanOrEqual(26);
      expect(entry.source).toMatch(/^https:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\//);
      bytes += animation.length + still.length;
    }
    expect(bytes).toBeLessThan(7 * 1024 * 1024);
  });
});
