// Development-only visual fixture: no API calls or persistent user data.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import FileViewer from "../src/renderer/FileViewer";
import { workspaceImageGallery } from "../src/renderer/image-gallery";
import { FluentProvider } from "@fluentui/react-components";
import type { ChatMessage, WorkspaceAttachment } from "@yuksalish/contracts";
import { MessengerView } from "../src/renderer/MessengerView";
import { attachmentImageCache } from "../src/renderer/attachment-image-cache";
import { initialChats, people } from "../src/renderer/test-fixtures/demo-data";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-2-focus.css";
import { useQaTheme } from "./color-theme";
import "../src/renderer/messenger-outgoing.css";
import "../src/renderer/messenger-voice.css";

const message = (id: string, authorId: string, body: string, hour: number, minute: number): ChatMessage => ({
  id, chatId: "finance", authorId, body,
  createdAt: `2026-10-03T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:00`,
  time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
});

const messages: readonly ChatMessage[] = [
  message("first", "baxtiyor", "Доброе утро! Посмотрел обновлённый план проекта.", 9, 12),
  message("second", "baxtiyor", "Финансовый раздел готов, остался последний документ от команды.", 9, 13),
  { ...message("left", "baxtiyor", "Дилшод Рахимов больше не в группе", 9, 15), systemKind: "member_left" },
  { ...message("ownership", "aziza", "Вам передано право управления этой группой", 9, 16), systemKind: "ownership_transferred" },
  message("reply", "aziza", "Спасибо! Сегодня соберу финальный пакет и отправлю на согласование.", 9, 18),
  { ...message("followup", "aziza", "Если будут замечания, напишите здесь — сразу поправлю.", 9, 19),
    reactions: [{ emoji: "👍", count: 2, reactedByCurrentUser: false, reactorUserIds: ["baxtiyor", "dilshod"] }] },
  message("later", "baxtiyor", "Отлично, договорились.", 9, 28),
  message("photo", "baxtiyor", "Файл", 9, 31),
  message("documents", "aziza", "Файл", 9, 35),
  message("caption-document", "baxtiyor", "Пожалуйста, посмотрите документ и напишите предложения по итогам обсуждения.", 9, 36),
  { ...message("mentions", "aziza", "!", 9, 37), mentionUserIds: ["baxtiyor", "dilshod"] },
  message("voice-incoming", "baxtiyor", "Голосовое сообщение", 9, 38),
  { ...message("voice-forwarded", "aziza", "Голосовое сообщение", 9, 39), forwarded: {
    kind: "message", authorId: "dilshod", authorName: "Дилшод Рахимов", available: true,
  } },
  { ...message("conference", "aziza", "Приглашение", 9, 40), zoomInvitation: {
    meetingId: "qa", topic: "Обсуждение проекта", startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T11:00:00Z",
    timezone: "Asia/Tashkent", status: "scheduled", organizerId: "aziza", participants: [], canRespond: false, available: true,
  } },
];
const attachments: WorkspaceAttachment[] = [
  { id: "qa-photo", ownerType: "message", ownerId: "photo", fileName: "photo.svg", contentType: "image/svg+xml", byteSize: 1000, documentRole: "general", sha256: "qa", uploadedByUserId: "baxtiyor", createdAt: "2026-10-03T09:31:00+05:00" },
  ...["Профиль_сотрудника.doc", "Итоговый_отчёт_за_октябрь_с_приложениями.pdf"].slice(0, new URLSearchParams(location.search).has("single") ? 1 : 2).map((fileName, index): WorkspaceAttachment => ({ id: `qa-document-${index}`, ownerType: "message", ownerId: "documents", fileName, contentType: index ? "application/pdf" : "application/msword", byteSize: 251904, documentRole: "general", sha256: "qa", uploadedByUserId: "aziza", createdAt: "2026-10-03T09:35:00+05:00" })),
  { id: "qa-caption-file", ownerType: "message", ownerId: "caption-document", fileName: "Предложения.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: 81000, documentRole: "general", sha256: "qa-caption", uploadedByUserId: "baxtiyor", createdAt: "2026-10-03T09:36:00+05:00" },
  ...["voice-incoming", "voice-forwarded"].map((ownerId): WorkspaceAttachment => ({ id: `qa-${ownerId}`, ownerType: "message", ownerId, fileName: "voice.webm", contentType: "audio/webm", mediaKind: "voice", mediaDurationMs: 22000, byteSize: 29000, documentRole: "general", sha256: "qa-voice", uploadedByUserId: "baxtiyor", createdAt: "2026-10-03T09:38:00+05:00" })),
];
const albumCount = Math.min(30, Math.max(0, Number(new URLSearchParams(location.search).get("album"))));
if (albumCount) {
  attachments.splice(0, 1, ...Array.from({ length: albumCount }, (_, index): WorkspaceAttachment => ({
    id: `qa-tile-${index}`, ownerType: "message", ownerId: "photo", fileName: `photo-${index + 1}.svg`,
    contentType: "image/svg+xml", byteSize: 1000, documentRole: "general", sha256: `qa-album-v1-${index}`,
    uploadedByUserId: "baxtiyor", createdAt: "2026-10-03T09:31:00+05:00",
    imageWidth: [700, 1600, 1000][index % 3], imageHeight: 1000,
  })));
}
if (new URLSearchParams(location.search).has("gallery")) {
  attachments.push({ ...attachments[0]!, id: "qa-earlier", ownerId: "later", fileName: "earlier.svg", createdAt: "2026-10-03T09:28:00+05:00" },
    { ...attachments[0]!, id: "qa-album-second", fileName: "album-second.svg", createdAt: "2026-10-03T09:32:00+05:00" });
}
const loadDemoImage = async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#39677b"/><stop offset="1" stop-color="#8bbcb7"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><circle cx="210" cy="110" r="60" fill="#e9e3ce"/><path d="M0 340L100 190L230 400H0M100 400L240 230L300 320V400" fill="#234b5b"/></svg>'], { type: "image/svg+xml" });
let imageDownloads = 0;
const loadImage = (attachment: WorkspaceAttachment) => !albumCount ? loadDemoImage() : attachmentImageCache.load("qa-photo-albums", attachment, async () => {
  imageDownloads += 1;
  document.documentElement.dataset.imageDownloads = String(imageDownloads);
  await new Promise(resolve => setTimeout(resolve, 300 + Number(attachment.id.split("-").at(-1)) % 4 * 400));
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${attachment.imageWidth}" height="1000"><rect width="100%" height="100%" fill="hsl(${Number(attachment.id.split("-").at(-1)) * 37} 40% 35%)"/><circle cx="50%" cy="35%" r="180" fill="#e6d6b6"/><text x="50%" y="70%" fill="white" text-anchor="middle" font-size="90">${attachment.fileName}</text></svg>`], { type: "image/svg+xml" });
});

document.body.style.background = "#eaf1f1";
function Preview() {
  const theme = useQaTheme();
  const [preview, setPreview] = useState<WorkspaceAttachment>();
  return <FluentProvider theme={theme ?? workspaceTheme} className="app-provider" style={{ height: "100dvh", padding: 16 }}>
    <MessengerView
      token="" currentUserId="aziza" currentUserRole="employee"
      chats={initialChats} messages={messages} tasks={[]} attachments={attachments} people={people}
      chatActions={{
        create: async () => initialChats[0]!, update: async () => initialChats[0]!,
        add: async () => initialChats[0]!, setMember: async () => initialChats[0]!,
        remove: async () => undefined, transfer: async () => initialChats[0]!,
        delete: async () => undefined,
      }}
      onSendMessage={async (chatId, body) => {
        if (new URLSearchParams(location.search).has("slowSend")) await new Promise<void>((resolve) => window.setTimeout(resolve, 12000));
        return { id: `qa-send-${Date.now()}`, chatId, body, authorId: "aziza", time: "12:00" };
      }} onSendVoiceMessage={async () => undefined}
      onReactMessage={async () => undefined} onPinMessage={async () => undefined}
      onEditMessage={async () => undefined} onDeleteMessage={async () => undefined}
      onCreateTaskFromMessage={() => undefined} onDownloadAttachment={setPreview}
      onLoadAttachment={loadImage} onMarkRead={() => undefined}
    />
    {preview && <FileViewer attachment={preview} images={workspaceImageGallery(preview, attachments, messages, people)}
      onLoad={loadImage} onLoadOffice={async () => { throw new Error("This fixture only supplies images"); }} onDownload={() => undefined} onClose={() => setPreview(undefined)} />}
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);

if (new URLSearchParams(window.location.search).has("open")) {
  window.setTimeout(() => document.querySelector<HTMLButtonElement>(".chat-row")?.click(), 400);
}

if (new URLSearchParams(window.location.search).has("open")) {
  window.setTimeout(() => document.querySelector<HTMLElement>('[data-chat-id="finance"] .chat-row')?.click(), 400);
}
if (new URLSearchParams(window.location.search).has("bottom")) {
  window.setTimeout(() => {
    const pane = document.querySelector<HTMLElement>(".message-scroll");
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, 1600);
}
