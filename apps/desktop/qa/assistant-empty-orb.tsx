// Synthetic visual QA surface. It never connects to a Workspace API.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { YuksalishAssistant } from "../src/renderer/YuksalishAssistant";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/assistant-chat.css";

document.body.style.minHeight = "100vh";
document.body.style.background = "linear-gradient(135deg, #eaf4f3, #f9fbfb 64%, #dcecf0)";
const networkFetch = window.fetch.bind(window);
window.fetch = (resource, options) => {
  const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
  if (url.pathname === "/api/v1/assistant/chats" && (!options?.method || options.method === "GET")) {
    return Promise.resolve(new Response(JSON.stringify([{
      id: "qa-chat", title: "Новый чат", isDefault: true,
      createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z",
    }]), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  if (url.pathname === "/api/v1/assistant/messages" && (!options?.method || options.method === "GET")) {
    return Promise.resolve(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  if (url.pathname.startsWith("/api/")) {
    return Promise.resolve(new Response(JSON.stringify({ detail: "Только визуальный предпросмотр: данные не отправляются." }),
      { status: 403, headers: { "Content-Type": "application/json" } }));
  }
  return networkFetch(resource, options);
};
createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={workspaceTheme}>
    <p style={{ padding: "8px 20px", fontSize: 12, color: "#52697b" }}>Локальный предпросмотр · без подключения к рабочим данным</p>
    <header className="global-bar" style={{ display: "flex", justifyContent: "flex-end", padding: 20 }}>
      <YuksalishAssistant token="qa-no-real-token" />
    </header>
  </FluentProvider>,
);
