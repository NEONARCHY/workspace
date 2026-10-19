// Synthetic shell: real MessengerView, no live API or account data.
import { useEffect, useState } from "react";
import type { ChatMessage } from "@yuksalish/contracts";
import { FloatingMessenger } from "../src/renderer/FloatingMessenger";
import type { MessengerViewProps } from "../src/renderer/MessengerView";
import { initialChats, people } from "../src/renderer/test-fixtures/demo-data";
import { WorkspaceSectionContent } from "../src/renderer/WorkspaceSectionContent";
import { observeBrowserViewport, useBrowserCompactLayout } from "../src/renderer/browser-layout";
import "../src/renderer/page-scroll-layout.css";

const noop = () => undefined;
export function FloatingMessengerFixture() {
  const params = new URLSearchParams(location.search);
  const rail = params.has("scrollrail");
  const history = Math.min(1000, Math.max(0, Number(params.get("history")) || 0));
  const compact = useBrowserCompactLayout();
  useEffect(() => {
    if (!rail) return;
    document.documentElement.classList.add("web-platform");
    return observeBrowserViewport();
  }, [rail]);
  const [section, setSection] = useState("Задачи");
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [chats, setChats] = useState(() => params.has("unread")
    ? initialChats.map(chat => ({ ...chat, unread: chat.id === "finance" ? Number(params.get("unread")) || 0 : 0 })) : initialChats);
  const [focusChatId, setFocusChatId] = useState<string>();
  const [sent, setSent] = useState<readonly { body: string; files: readonly string[] }[]>([]);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([
    ...Array.from({ length: history }, (_, index) => ({ id: `qa-history-${index}`, chatId: "finance", authorId: index % 2 ? "baxtiyor" : "aziza", body: `История ${index}: сообщение для проверки позиции открытия чата`, time: "11:00" })),
    { id: "qa-original", chatId: "finance", authorId: "baxtiyor", body: "Сообщение для проверки мини-окна", time: "12:00" },
  ]);
  const messenger: MessengerViewProps = {
    token: "", currentUserId: "aziza", currentUserRole: "employee", chats, messages, people,
    focusChatId, tasks: [], attachments: [], canUseAssistant: true,
    chatActions: { create: async () => initialChats[0]!, update: async () => initialChats[0]!, add: async () => initialChats[0]!, setMember: async () => initialChats[0]!, remove: async () => undefined, transfer: async () => initialChats[0]!, delete: async () => undefined },
    onSendMessage: async (chatId, body, files) => {
      if (body === "Ошибка сети") throw new Error("Тестовая ошибка отправки");
      setSent(current => [...current, { body, files: files.map(file => file.name) }]);
      const message = { id: crypto.randomUUID(), chatId, authorId: "aziza", body, time: "12:01" };
      setMessages(current => [...current, message]); return message;
    },
    onSendVoiceMessage: async () => undefined, onReactMessage: async () => undefined,
    onPinMessage: async () => undefined, onEditMessage: async () => undefined, onDeleteMessage: async () => undefined,
    onCreateTaskFromMessage: noop, onDownloadAttachment: noop, onLoadAttachment: async () => new Blob(),
    onMarkRead: id => setChats(current => current.map(chat => chat.id === id ? { ...chat, unread: 0 } : chat)),
    onForwardContent: async (chatId, source, id) => {
      const original = messages.find(message => message.id === source.id)!;
      const forwarded = { ...original, id, chatId, authorId: "aziza" };
      setMessages(current => [...current, forwarded]); return forwarded;
    },
  };
  return <>
    <nav aria-label="Тестовые страницы" style={{ display: "flex", gap: 12, padding: 12, ...(rail ? { height: 70, boxSizing: "border-box", flexWrap: "wrap" } : {}) }}>
      {["Задачи", "Проекты", "Мессенджер"].map(name => <button key={name} onClick={() => setSection(name)}>{name}</button>)}
      <button onClick={() => setChats(current => current.map(chat => ({ ...chat, unread: 0 })))}>Прочитать все в тесте</button>
      {params.has("jumpqa") ? <button onClick={() => {
        setMessages(current => [...current, { id: crypto.randomUUID(), chatId: "finance", authorId: "baxtiyor", body: "Новое входящее сообщение в тесте", time: "12:02" }]);
        setChats(current => current.map(chat => chat.id === "finance" ? { ...chat, unread: chat.unread + 1 } : chat));
      }}>Входящее сообщение в тесте</button> : null}
    </nav>
    {rail ? <div className={`app-shell${compact ? " browser-compact" : ""}`} style={{ gridTemplateColumns: "minmax(0, 1fr)", height: "calc(100dvh - 70px)", paddingTop: 0 }}>
      <div className="app-stage"><WorkspaceSectionContent authorityKey="qa" section={section}>
        {section === "Мессенджер" ? <div className="messenger-page-slot" ref={setSlot} />
          : <section className="workspace-view"><h1>{section}</h1><div style={{ height: 1400 }}>Прокручиваемая тестовая страница</div></section>}
      </WorkspaceSectionContent></div>
    </div> : <section style={{ position: "absolute", inset: "70px 16px 16px", minHeight: 0 }}>
      {section === "Мессенджер" ? <div className="messenger-page-slot" ref={setSlot} /> : <h1>{section}</h1>}
    </section>}
    <output className="sr-only" data-sent={JSON.stringify(sent)} />
    <FloatingMessenger messenger={messenger} fullPage={section === "Мессенджер"} pageSlot={slot}
      onMinimizeFullPage={() => setSection("Задачи")}
      onOpenFullPage={id => { setFocusChatId(id); setSection("Мессенджер"); }} />
  </>;
}
