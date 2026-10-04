// Development-only visual fixture: no API calls or persistent user data.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { ChatMessage } from "@yuksalish/contracts";
import { MessengerView } from "../src/renderer/MessengerView";
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
];

document.body.style.background = "#eaf1f1";
createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={workspaceTheme} className="app-provider" style={{ height: "100dvh", padding: 16 }}>
    <MessengerView
      token="" currentUserId="aziza" currentUserRole="employee"
      chats={initialChats} messages={messages} tasks={[]} attachments={[]} people={people}
      chatActions={{
        create: async () => initialChats[0]!, update: async () => initialChats[0]!,
        add: async () => initialChats[0]!, setMember: async () => initialChats[0]!,
        remove: async () => undefined, transfer: async () => initialChats[0]!,
        delete: async () => undefined,
      }}
      onSendMessage={() => undefined} onSendVoiceMessage={async () => undefined}
      onReactMessage={async () => undefined} onPinMessage={async () => undefined}
      onEditMessage={async () => undefined} onDeleteMessage={async () => undefined}
      onCreateTaskFromMessage={() => undefined} onDownloadAttachment={() => undefined}
      onLoadAttachment={async () => new Blob()} onMarkRead={() => undefined}
    />
  </FluentProvider>,
);

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
