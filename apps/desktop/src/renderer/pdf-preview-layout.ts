export interface PdfPageSize { readonly width: number; readonly height: number }
export type PdfZoomMode = "page" | "width" | number;

export function validPdfPageSize(size: PdfPageSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    && Math.max(size.width, size.height) <= 20_000
    && Math.max(size.width / size.height, size.height / size.width) <= 100;
}

export function pdfPageScale(page: PdfPageSize, frame: PdfPageSize, mode: PdfZoomMode): number {
  if (typeof mode === "number") return mode;
  const width = Math.max(1, frame.width - 32) / page.width;
  const height = Math.max(1, frame.height - 40) / page.height;
  return Math.min(3, mode === "page" ? Math.min(width, height) : width);
}

/** Bound backing-store memory independently of CSS zoom and monitor density. */
export function pdfPixelRatio(size: PdfPageSize, density: number): number {
  return Math.min(2, density || 1, Math.sqrt(4_000_000 / (size.width * size.height)),
    8192 / Math.max(size.width, size.height));
}
