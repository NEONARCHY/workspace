// Synthetic visual QA surface. It never connects to a Workspace API.
import { createRoot } from "react-dom/client";
import { FluentProvider, Input, Button } from "@fluentui/react-components";
import { useState } from "react";
import { WorkdayControl } from "../src/renderer/WorkdayControl";
import { WorkspaceIdentity } from "../src/renderer/WorkspaceIdentity";
import { YuksalishAssistant } from "../src/renderer/YuksalishAssistant";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import type { AssistantMessage, WorkdayMe } from "@yuksalish/contracts";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/responsive.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/zoom.css";
import "../src/renderer/motion.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/assistant-chat.css";

document.body.style.minHeight = "100vh";
document.body.style.background = "linear-gradient(135deg, #eaf4f3, #f9fbfb 64%, #dcecf0)";
const networkFetch = window.fetch.bind(window);
let workdayStatus: WorkdayMe["status"] = "not_started";
const workday = (): WorkdayMe => ({ status: workdayStatus,
  schedule: { userId: "qa-user", startsAt: "09:00:00", endsAt: "18:00:00" },
  session: null, absenceKind: null, asOf: "2026-10-08T04:00:00Z" });
const history = new Map<string, AssistantMessage[]>();
const firstChat = new URLSearchParams(location.search).has("history") ? "qa-work" : "qa-chat";
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { "Content-Type": "application/json" },
});
window.fetch = (resource, options) => {
  const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
  if (url.pathname === "/api/v1/workday/me") return Promise.resolve(json(workday()));
  if (url.pathname === "/api/v1/workday/start" || url.pathname === "/api/v1/workday/finish") {
    workdayStatus = url.pathname.endsWith("start") ? "working" : "finished";
    return Promise.resolve(json(workday()));
  }
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
function TopbarStand() {
  const [name, setName] = useState("Тестовый пользователь с длинным именем");
  const [inset, setInset] = useState(false);
  const [zoom, setZoom] = useState(false);
  return <FluentProvider className="app-provider" theme={workspaceTheme} style={{ zoom: zoom ? 1.25 : 1 }}>
    <p style={{ padding: "8px 20px", fontSize: 12, color: "#52697b" }}>Локальный предпросмотр · сообщения остаются только в памяти этой страницы</p>
    <nav style={{ display: "flex", gap: 18, padding: "0 20px", fontSize: 13 }}>
      <a href="?">Пустой чат / повторить</a><a href="?history=1">Чат с историей</a>
    </nav>
    <header className="global-bar" style={{ marginInlineStart: inset ? 240 : 0, padding: 20 }}>
      <span>Верхняя панель</span><div className="workspace-top-context">
      <WorkdayControl token="qa-no-real-token" />
      <YuksalishAssistant token="qa-no-real-token" />
      <WorkspaceIdentity token="qa-no-real-token" person={{ id: "qa-user", name, initials: "ТП", role: "Сотрудник", color: "#293a55" }}
        onSupport={() => {}} onSettings={() => {}} onLogout={() => {}} supportMode="support" />
      </div>
    </header>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 20 }}>
      <Input aria-label="Тестовое имя пользователя" value={name} onChange={(_, data) => setName(data.value)} />
      <Button onClick={() => setInset(value => !value)}>Изменить ширину панели</Button>
      <Button onClick={() => setZoom(value => !value)}>Масштаб 125%</Button>
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<TopbarStand />);
