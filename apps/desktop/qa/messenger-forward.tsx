// Isolated UI fixture: all messages and forwarding outcomes remain in memory.
import { useRef, useState } from "react";
import type { ChatMessage, WorkspaceAttachment } from "@yuksalish/contracts";
import { MessengerView } from "../src/renderer/MessengerView";
import { initialChats, people } from "../src/renderer/test-fixtures/demo-data";

const originals: ChatMessage[] = [
  { id: "qa-photo", chatId: "finance", authorId: "baxtiyor", body: "Фото с подписью", time: "12:00" },
  { id: "qa-text", chatId: "finance", authorId: "aziza", body: "Второе сообщение", time: "12:01" },
];
const image = new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), char => char.charCodeAt(0))], { type: "image/png" });
const photo: WorkspaceAttachment = { id: "qa-photo-file", ownerType: "message", ownerId: "qa-photo",
  fileName: "qa-photo.png", contentType: "image/png", byteSize: image.size, sha256: "a".repeat(64),
  uploadedByUserId: "baxtiyor", documentRole: "general", mediaKind: "file", imageWidth: 1, imageHeight: 1,
  createdAt: "2026-10-19T07:00:00Z" };
const noop = () => undefined;
export function MessengerForwardFixture() {
  const [messages, setMessages] = useState(originals);
  const [files, setFiles] = useState([photo]);
  const [attempts, setAttempts] = useState<readonly { source: string; request: string }[]>([]);
  const failed = useRef(false);
  return <><output className="sr-only" data-forward-attempts={JSON.stringify(attempts)} />
    <MessengerView token="" currentUserId="aziza" currentUserRole="employee" chats={initialChats}
      focusChatId="finance" messages={messages} tasks={[]} attachments={files} people={people}
      chatActions={{ create: async () => initialChats[0]!, update: async () => initialChats[0]!, add: async () => initialChats[0]!, setMember: async () => initialChats[0]!, remove: async () => undefined, transfer: async () => initialChats[0]!, delete: async () => undefined }}
      onSendMessage={noop} onSendVoiceMessage={async () => undefined} onReactMessage={async () => undefined}
      onPinMessage={async () => undefined} onEditMessage={async () => undefined} onDeleteMessage={async () => undefined}
      onCreateTaskFromMessage={noop} onDownloadAttachment={noop} onLoadAttachment={async () => image} onMarkRead={noop}
      onForwardContent={async (chatId, source, requestId) => {
        setAttempts(current => [...current, { source: source.id, request: requestId }]);
        if (source.id === "qa-text" && !failed.current) { failed.current = true; throw new Error("Тестовый обрыв сети"); }
        const original = originals.find(item => item.id === source.id)!;
        const message = { ...original, id: requestId, chatId, authorId: "aziza", forwarded: { kind: "message" as const, authorId: original.authorId, authorName: people.find(person => person.id === original.authorId)!.name, available: true } };
        setMessages(current => [...current.filter(item => item.id !== requestId), message]);
        if (source.id === "qa-photo") setFiles(current => [...current, { ...photo, id: `${requestId}-photo`, ownerId: requestId }]);
        return message;
      }} />
  </>;
}
