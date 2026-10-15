import type { ChatMessage, WorkspaceAttachment } from "@yuksalish/contracts";
import { fileViewerKind } from "./file-viewer-kind";

export interface GalleryImage<T> {
  readonly attachment: T;
  readonly caption?: string;
  readonly author?: string;
  readonly createdAt?: string;
  readonly messageId?: string;
  readonly chatId?: string;
}
const sentAt = (value?: string) => value ? Date.parse(value) || 0 : 0;

/** Only supplied, authorized records are eligible; never concatenate different chats. */
export function workspaceImageGallery(selected: WorkspaceAttachment, attachments: readonly WorkspaceAttachment[],
  messages: readonly ChatMessage[], people: readonly { readonly id: string; readonly name: string }[]): readonly GalleryImage<WorkspaceAttachment>[] {
  const images = attachments.filter((item) => fileViewerKind(item) === "image");
  if (selected.ownerType !== "message") return images.filter((item) => item.ownerType === selected.ownerType && item.ownerId === selected.ownerId)
    .sort((a, b) => sentAt(a.createdAt) - sentAt(b.createdAt)).map((attachment) => ({ attachment, createdAt: attachment.createdAt }));
  const source = messages.find((message) => message.id === selected.ownerId && !message.deletedAt);
  if (!source) return [];
  const byMessage = new Map<string, WorkspaceAttachment[]>();
  for (const image of images) {
    if (image.ownerType !== "message") continue;
    const list = byMessage.get(image.ownerId) ?? [];
    list.push(image); byMessage.set(image.ownerId, list);
  }
  return messages.filter((message) => message.chatId === source.chatId && !message.deletedAt && !message.systemKind)
    .slice().sort((a, b) => sentAt(a.createdAt) - sentAt(b.createdAt))
    .flatMap((message) => (byMessage.get(message.id) ?? []).sort((a, b) => sentAt(a.createdAt) - sentAt(b.createdAt)).map((attachment) => ({
      attachment, caption: message.body.trim() === "Файл" ? "" : message.body,
      author: people.find((person) => person.id === message.authorId)?.name,
      createdAt: message.createdAt ?? attachment.createdAt, messageId: message.id, chatId: message.chatId,
    })));
}
