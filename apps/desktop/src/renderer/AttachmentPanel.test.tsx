import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AttachmentChips, embeddedMp3Artwork, isAudioAttachment } from "./AttachmentPanel";
import type { WorkspaceAttachment } from "@yuksalish/contracts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("sizes an image preview to its natural aspect ratio, including portrait images", async () => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const attachment = { id: "photo", ownerType: "message", ownerId: "one", fileName: "photo.png", contentType: "image/png", byteSize: 1024 } as WorkspaceAttachment;
  const { container } = render(createElement(AttachmentChips, { attachments: [attachment], onDownload: vi.fn(), onLoad: async () => new Blob() }));
  const image = await screen.findByAltText("photo.png");
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 600 }, naturalHeight: { configurable: true, value: 1200 } });
  fireEvent.load(image);
  expect(container.querySelector(".attachment-image-card")).toHaveClass("has-image-size");
  expect(container.querySelector(".attachment-image-card")).toHaveStyle({ width: "160px" });
});

function bytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.readAsArrayBuffer(blob);
  });
}

describe("audio attachments", () => {
  it("recognizes common audio MIME types and extensions", () => {
    expect(isAudioAttachment({ contentType: "audio/mpeg", fileName: "track.mp3" })).toBe(true);
    expect(isAudioAttachment({ contentType: "application/octet-stream", fileName: "track.flac" })).toBe(true);
    expect(isAudioAttachment({ contentType: "application/pdf", fileName: "brief.pdf" })).toBe(false);
  });

  it("extracts an ID3 APIC cover from an MP3 file", async () => {
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const body = Uint8Array.from([0, ...new TextEncoder().encode("image/jpeg"), 0, 3, 0, ...image]);
    const frameSize = body.length;
    const frame = Uint8Array.from([
      ...new TextEncoder().encode("APIC"),
      0, 0, 0, frameSize,
      0, 0,
      ...body,
    ]);
    const tagSize = frame.length;
    const mp3 = Uint8Array.from([
      ...new TextEncoder().encode("ID3"), 3, 0, 0,
      (tagSize >> 21) & 0x7f, (tagSize >> 14) & 0x7f, (tagSize >> 7) & 0x7f, tagSize & 0x7f,
      ...frame,
    ]);
    const artwork = await embeddedMp3Artwork(new Blob([mp3], { type: "audio/mpeg" }));
    expect(artwork?.type).toBe("image/jpeg");
    expect(await bytes(artwork!)).toEqual(Array.from(image));
  });
});
