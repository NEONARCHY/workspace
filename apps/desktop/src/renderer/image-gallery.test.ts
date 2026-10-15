import { describe, expect, it } from "vitest";
import type { ChatMessage, WorkspaceAttachment } from "@yuksalish/contracts";
import { workspaceImageGallery } from "./image-gallery";
const message = (id: string, chatId: string, authorId = "one"): ChatMessage => ({ id, chatId, authorId, body: `Подпись ${id}`, time: "12:00", createdAt: `2026-10-15T12:0${id.slice(-1)}:00Z` });
const photo = (id: string, ownerId: string): WorkspaceAttachment => ({ id, ownerId, ownerType: "message", fileName: `${id}.png`, contentType: "image/png", byteSize: 12, sha256: "test", uploadedByUserId: "one", documentRole: "general", createdAt: "2026-10-15T12:00:00Z" });
describe("workspaceImageGallery", () => {
  it("continues across albums and authors, but not other chats or deleted messages", () => {
    const first = photo("first", "m1"); const second = photo("second", "m2"); const third = photo("third", "m2");
    const attachments = [photo("other", "m3"), second, first, third, photo("deleted", "m4")];
    const messages = [message("m2", "chat", "two"), message("m3", "other"), message("m1", "chat"), { ...message("m4", "chat"), deletedAt: "now" }];
    const gallery = workspaceImageGallery(second, attachments, messages, [{ id: "two", name: "Второй автор" }]);
    expect(gallery.map((item) => item.attachment.id)).toEqual(["first", "second", "third"]);
    expect(gallery[1]).toMatchObject({ caption: "Подпись m2", author: "Второй автор", chatId: "chat", messageId: "m2" });
  });
  it("ignores non-images, hides generated file captions and never mutates source arrays", () => {
    const first = photo("first", "m1");
    const attachments = Object.freeze([first, { ...photo("pdf", "m1"), contentType: "application/pdf", fileName: "file.pdf" }]);
    const messages = Object.freeze([{ ...message("m1", "chat"), body: "Файл" }]);
    expect(workspaceImageGallery(first, attachments, messages, [])).toHaveLength(1);
    expect(workspaceImageGallery(first, attachments, messages, [])[0]?.caption).toBe("");
  });
  it("isolates non-chat galleries to the exact owner type and record", () => {
    const first = { ...photo("first", "record"), ownerType: "task" as const };
    expect(workspaceImageGallery(first, [first, photo("other-type", "record"), { ...first, id: "other-record", ownerId: "another" }], [], []).map((item) => item.attachment.id)).toEqual(["first"]);
  });
});
