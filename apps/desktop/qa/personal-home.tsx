// Isolated QA: all employee data below is a labelled fixture; no API writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import { PersonalHomeView } from "../src/renderer/PersonalHomeView";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { InterfaceLocalization } from "../src/renderer/InterfaceLocalization";
import { ScrollbarEdges } from "../src/renderer/ScrollbarEdges";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import { homeEfficiency, homeFixture, homeRecognition } from "../src/renderer/test-fixtures/personal-home-fixture";
import { people } from "../src/renderer/test-fixtures/demo-data";
import { setInterfaceLocale, type Locale } from "@yuksalish/i18n";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/employee-recognition.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/page-canvas.css";
import "../src/renderer/surface-hierarchy.css";
let employeeId = "aziza";
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const url = String(input);
  if (!url.includes("/api/v1/")) return originalFetch(input, options);
  if (options?.method && options.method !== "GET") throw new Error("QA запрещает записи в API");
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  if (url.includes("/profile/me/efficiency")) return json(homeEfficiency(employeeId));
  if (url.includes("/recognition/profiles/")) return json(homeRecognition(employeeId));
  if (url.includes("/home/reactions")) return json({ totalCount: 18, reactions: [{ emoji: "👍", count: 9 }, { emoji: "❤️", count: 5 }, { emoji: "👏", count: 4 }] });
  if (url.includes("/ai-referent/incoming")) return json({ letters: [], totalCount: 0 });
  if (url.includes("/incoming-letters")) return json({ detail: "Интеграция ЭДО ещё не подключена" }, 503);
  if (url.includes("/project-hub")) return json({ projects: [], workstreams: [], items: [], requests: [] });
  return json({ detail: "В тестовой среде этот переход только отмечается" }, 404);
};
function Demo() {
  const [userId, setUserId] = useState(employeeId), [target, setTarget] = useState("");
  const [restricted, setRestricted] = useState(false), [urgent, setUrgent] = useState(false);
  const base = homeFixture(userId);
  const workspace = urgent ? base : { ...base, tasks: [], notifications: [] };
  return <FluentProvider theme={workspaceTheme} className="app-provider" style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "transparent" }}>
    <InterfaceLocalization /><ScrollbarEdges />
    <nav aria-label="Проверочные состояния Главной" style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "12px 20px", flex: "none" }}>
      <span style={{ alignSelf: "center", fontSize: 12 }}>Тестовые данные · записи в API отключены</span>
      <select aria-label="Тестовый сотрудник" value={userId} onChange={e => { employeeId = e.target.value; setUserId(employeeId); }}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <Button onClick={() => setUrgent(v => !v)}>{urgent ? "Убрать срочные сигналы" : "Добавить срочные сигналы"}</Button>
      <Button onClick={() => setRestricted(v => !v)}>{restricted ? "Вернуть права" : "Ограничить права"}</Button>
      <select aria-label="Язык тестовой страницы" defaultValue="ru" onChange={e => setInterfaceLocale(e.target.value as Locale)}><option value="ru">Русский</option><option value="uz_cyrl">Ўзбекча</option><option value="uz_latn">O‘zbekcha</option></select>
      <output role="status">{target}</output>
    </nav>
    <EmployeeProfileProvider onOpenProfile={id => setTarget("Профиль: " + id)}>
      <main className="app-content" style={{ margin: "0 20px", minHeight: 0, flex: 1 }}>
        <PersonalHomeView key={userId} workspace={workspace} token={"qa:" + userId} canView={key => !restricted || key === "notifications" || key === "tasks"}
          onOpen={t => setTarget("Переход: " + t.section + (t.entityId ? " · " + t.entityId : ""))}
          onOpenNotification={n => setTarget("Уведомление: " + n.id)} onRefresh={async () => undefined} />
      </main>
    </EmployeeProfileProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
