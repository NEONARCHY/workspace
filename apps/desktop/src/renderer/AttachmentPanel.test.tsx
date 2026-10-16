import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AttachmentChips, embeddedMp3Artwork, isAudioAttachment } from "./AttachmentPanel";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { MessageMetadata } from "./MessageMetadata";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("places edited metadata only in the last document's wrapping size line and preserves opening", () => {
  const open = vi.fn();
  const attachments = ["first", "last"].map(id => ({ id, ownerType: "message", ownerId: "m", fileName: `${id}.pdf`, contentType: "application/pdf", byteSize: 1024 } as WorkspaceAttachment));
  const { container } = render(<AttachmentChips attachments={attachments} onDownload={open} documentMetadata={<MessageMetadata
    message={{ id: "m", chatId: "c", authorId: "u", body: "Текст", time: "19:55", editedAt: "2026-10-16T09:00:00Z" }} own />} />);
  const rows = container.querySelectorAll(".attachment-document");
  expect(rows[0]!.querySelector(".message-meta")).toBeNull();
  expect(rows[1]!.querySelector(".attachment-document-details > .message-meta")).toHaveTextContent("изменено · 19:55");
  expect(container.querySelectorAll(".message-meta")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "Сообщение отправлено" })).toBeInTheDocument();
  fireEvent.click(rows[1]!);
  expect(open).toHaveBeenCalledWith(attachments[1]);
});
it("reserves portrait geometry before loading and never changes it after decoding", async () => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const attachment = { id: "photo", ownerType: "message", ownerId: "one", fileName: "photo.png", contentType: "image/png", byteSize: 1024, imageWidth: 600, imageHeight: 1200 } as WorkspaceAttachment;
  const { container } = render(createElement(AttachmentChips, { attachments: [attachment], onDownload: vi.fn(), onLoad: async () => new Blob() }));
  const image = await screen.findByAltText("photo.png");
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 600 }, naturalHeight: { configurable: true, value: 1200 } });
  fireEvent.load(image);
  expect(container.querySelector(".attachment-image-card")).toHaveStyle({ width: "160px" });
  expect(container.querySelector(".attachment-image-thumb")).toHaveStyle({ aspectRatio: "0.5" });
});

function bytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.readAsArrayBuffer(blob);
  });
}

it("keeps message media openable without the duplicate file footer", () => {
  const open = vi.fn();
  const attachment = { id: "media", ownerType: "message", ownerId: "one", fileName: "photo.png", contentType: "image/png", byteSize: 1024 } as WorkspaceAttachment;
  const view = render(createElement(AttachmentChips, { attachments: [attachment], presentation: "media", onDownload: open, onLoad: async () => new Blob() }));
  fireEvent.click(screen.getByRole("button", { name: "Открыть изображение: photo.png" }));
  expect(open).toHaveBeenCalledWith(attachment);
  expect(view.container.querySelector(".attachment-media-preview")?.children).toHaveLength(1);
  expect(view.container.querySelector(".is-message-media")).not.toBeNull();
  view.rerender(createElement(AttachmentChips, { attachments: [attachment], onDownload: open, onLoad: async () => new Blob() }));
  expect(view.container.querySelector(".attachment-media-preview")?.children).toHaveLength(2);
});

it("keeps loaded images mounted offscreen and does not reload on metadata refresh", async () => {
  let visibility!: (entries: { isIntersecting: boolean }[]) => void;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof visibility) { visibility = callback; }
    observe() {} disconnect() {}
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retained");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const item = { id: "retained", sha256: "retained-sha", fileName: "retained.png", contentType: "image/png", imageWidth: 800, imageHeight: 1200 } as WorkspaceAttachment;
  const load = vi.fn(async () => new Blob(["original"]));
  const { rerender } = render(createElement(AttachmentChips, { attachments: [item], onDownload: vi.fn(), onLoad: load }));
  act(() => visibility([{ isIntersecting: true }]));
  const image = await screen.findByAltText("retained.png");
  act(() => visibility([{ isIntersecting: false }]));
  expect(image).toBeInTheDocument(); expect(image).toHaveAttribute("src", "blob:retained");
  rerender(createElement(AttachmentChips, { attachments: [{ ...item }], onDownload: vi.fn(), onLoad: load }));
  expect(load).toHaveBeenCalledOnce();
});

it("splits 17 image attachments into two stable tile albums", () => {
  const attachments = Array.from({ length: 17 }, (_, index) => ({ id: String(index), fileName: `p${index}.png`, contentType: "image/png", sha256: `image-${index}`, imageWidth: index % 2 ? 600 : 1600, imageHeight: 1000 } as WorkspaceAttachment));
  const view = render(createElement(AttachmentChips, { attachments, presentation: "media", onDownload: vi.fn(), onLoad: vi.fn(async () => new Blob()) }));
  expect(screen.getByRole("group", { name: "Альбом · 10 фото" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Альбом · 7 фото" })).toBeInTheDocument();
  expect(view.container.querySelectorAll(".attachment-image-album button")).toHaveLength(17);
});

it("renders document names and sizes as one keyboard-accessible file row", () => {
  const open = vi.fn();
  const attachment = { id: "document", fileName: "Полный_отчёт_с_очень_длинным_названием.pdf", contentType: "application/pdf", byteSize: 760000 } as WorkspaceAttachment;
  const { container } = render(createElement(AttachmentChips, { attachments: [attachment], onDownload: open }));
  const button = screen.getByRole("button", { name: `${attachment.fileName} 743 КБ` });
  expect(button).toHaveClass("attachment-document");
  expect(container.querySelector(".attachment-document-icon")).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector(".attachment-document-copy > small")).toHaveTextContent("743 КБ");
  fireEvent.click(button);
  expect(open).toHaveBeenCalledWith(attachment);
});

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
