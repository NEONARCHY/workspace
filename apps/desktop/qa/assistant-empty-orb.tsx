// Synthetic visual QA surface. It never connects to a Workspace API.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { YuksalishAssistant } from "../src/renderer/YuksalishAssistant";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import type { AssistantMessage } from "@yuksalish/contracts";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/assistant-chat.css";

document.body.style.minHeight = "100vh";
document.body.style.background = "linear-gradient(135deg, #eaf4f3, #f9fbfb 64%, #dcecf0)";
const networkFetch = window.fetch.bind(window);
const history = new Map<string, AssistantMessage[]>();
const firstChat = new URLSearchParams(location.search).has("history") ? "qa-work" : "qa-chat";
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { "Content-Type": "application/json" },
});
window.fetch = (resource, options) => {
  const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
  if (url.pathname === "/api/v1/assistant/chats" && (!options?.method || options.method === "GET")) {
    const chats = [{
      id: "qa-chat", title: "Новый чат", isDefault: true,
      createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z",
    }, {
      id: "qa-work", title: "План рабочей недели", isDefault: false,
      createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z",
    }, {
      id: "qa-text", title: "Подготовка текста", isDefault: false,
      createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z",
    }];
    chats.sort((a, b) => Number(b.id === firstChat) - Number(a.id === firstChat));
    return Promise.resolve(json(chats));
  }
  if (url.pathname === "/api/v1/assistant/messages" && (!options?.method || options.method === "GET")) {
    const chatId = url.searchParams.get("chat_id") ?? "qa-chat";
    const messages = history.get(chatId) ?? (chatId === "qa-work" ? [{
      id: "qa-question", role: "user", model: "flash-lite", content: "Помоги спланировать неделю.",
      createdAt: "2026-10-05T10:00:00Z",
    }, {
      id: "qa-answer", role: "assistant", model: "flash-lite",
      content: "Начнём с трёх приоритетов: важные задачи, встречи и время для спокойной работы. Какие задачи нужно завершить на этой неделе?",
      createdAt: "2026-10-05T10:01:00Z",
    }] : []);
    return Promise.resolve(json(messages));
  }
  if (url.pathname === "/api/v1/assistant/messages" && options?.method === "POST") {
    const body = JSON.parse(typeof options.body === "string" ? options.body : "{}") as { message?: string; chat_id?: string };
    const chatId = body.chat_id ?? "qa-chat";
    const answer: AssistantMessage = { id: `qa-answer-${Date.now()}`, role: "assistant", model: "flash-lite",
      content: "Это тестовый ответ для проверки анимации. Никакие сообщения не отправляются на рабочий сервер.",
      createdAt: new Date().toISOString() };
    history.set(chatId, [...(history.get(chatId) ?? []), { id: `qa-question-${Date.now()}`,
      role: "user", model: "flash-lite", content: body.message ?? "Тест", createdAt: answer.createdAt }, answer]);
    return new Promise((resolve) => window.setTimeout(() => resolve(json(answer)), 900));
  }
  if (url.pathname === "/api/v1/assistant/chats" && options?.method === "POST") {
    return Promise.resolve(json({ id: `qa-new-${Date.now()}`, title: "Новый чат", isDefault: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  }
  const clearing = url.pathname.match(/^\/api\/v1\/assistant\/chats\/([^/]+)\/messages$/);
  if (clearing && options?.method === "DELETE") {
    history.set(clearing[1]!, []);
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  if (url.pathname.startsWith("/api/")) {
    return Promise.resolve(new Response(JSON.stringify({ detail: "Только визуальный предпросмотр: данные не отправляются." }),
      { status: 403, headers: { "Content-Type": "application/json" } }));
  }
  return networkFetch(resource, options);
};
createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={workspaceTheme}>
    <p style={{ padding: "8px 20px", fontSize: 12, color: "#52697b" }}>Локальный предпросмотр · сообщения остаются только в памяти этой страницы</p>
    <nav style={{ display: "flex", gap: 18, padding: "0 20px", fontSize: 13 }}>
      <a href="?">Пустой чат / повторить</a><a href="?history=1">Чат с историей</a>
    </nav>
    <header className="global-bar" style={{ display: "flex", justifyContent: "flex-end", padding: 20 }}>
      <YuksalishAssistant token="qa-no-real-token" />
    </header>
  </FluentProvider>,
);
