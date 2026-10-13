import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AttachmentPanel, embeddedMp3Artwork, isAudioAttachment } from "./AttachmentPanel";

const taskAttachment: WorkspaceAttachment = {
  id: "file-1", ownerType: "task", ownerId: "task-1", fileName: "report.pdf",
  contentType: "application/pdf", byteSize: 512, sha256: "a".repeat(64),
  uploadedByUserId: "author-1", documentRole: "general", createdAt: "2026-10-13T10:00:00Z",
};

afterEach(cleanup);

describe("task attachment removal", () => {
  it("requires confirmation and calls deletion once", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<AttachmentPanel attachments={[taskAttachment]} canUpload={false} canDelete={() => true}
      onDelete={onDelete} onUpload={vi.fn()} onDownload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Удалить вложение report.pdf" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("group", { name: "Подтверждение удаления вложения" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Удалить вложение report.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить файл" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith(taskAttachment);
    await waitFor(() => expect(screen.queryByRole("group", { name: "Подтверждение удаления вложения" })).toBeNull());
  });

  it("keeps the file and shows the server error for a retry", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("Нет права удалить файл"));
    render(<AttachmentPanel attachments={[taskAttachment]} canUpload={false} canDelete={() => true}
      onDelete={onDelete} onUpload={vi.fn()} onDownload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Удалить вложение report.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить файл" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет права удалить файл");
    expect(screen.getByRole("button", { name: "report.pdf 512 Б" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить файл" })).toBeEnabled();
  });

  it("does not offer deletion without permission", () => {
    render(<AttachmentPanel attachments={[taskAttachment]} canUpload={false} canDelete={() => false}
      onDelete={vi.fn()} onUpload={vi.fn()} onDownload={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Удалить вложение report.pdf" })).toBeNull();
  });
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
