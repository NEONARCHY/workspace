import { describe, expect, it } from "vitest";
import { pdfPageScale, pdfPixelRatio, validPdfPageSize } from "./pdf-preview-layout";

describe("document page fitting", () => {
  it.each([{ width: 600, height: 900 }, { width: 900, height: 600 }])("fits a complete page in both axes: %j", page => {
    const frame = { width: 800, height: 600 };
    const scale = pdfPageScale(page, frame, "page");
    expect(page.width * scale).toBeLessThanOrEqual(frame.width - 32);
    expect(page.height * scale).toBeLessThanOrEqual(frame.height - 40);
    expect(pdfPageScale(page, frame, "width") * page.width).toBeCloseTo(frame.width - 32);
    expect(pdfPageScale(page, frame, "comfortable")).toBeCloseTo(Math.min(scale * 1.15, (frame.width - 32) / page.width));
    expect(pdfPageScale(page, frame, 1.5)).toBe(1.5);
  });
  it("refits narrow/short viewports and bounds canvas memory and dimensions", () => {
    const scale = pdfPageScale({ width: 600, height: 900 }, { width: 300, height: 350 }, "page");
    expect(scale * 900).toBeCloseTo(310);
    const size = { width: 6000, height: 9000 };
    const ratio = pdfPixelRatio(size, 3);
    expect(size.width * size.height * ratio ** 2).toBeLessThanOrEqual(4_000_001);
    expect(Math.max(size.width, size.height) * ratio).toBeLessThanOrEqual(8192);
  });
  it("rejects unsafe or malformed page dimensions", () => {
    for (const size of [{ width: 0, height: 900 }, { width: NaN, height: 900 }, { width: 30_000, height: 900 }, { width: 1, height: 900 }]) expect(validPdfPageSize(size)).toBe(false);
    expect(validPdfPageSize({ width: 600, height: 900 })).toBe(true);
  });
});
