// Development-only fixture: production navigation/header components, no API calls.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { Alert24Regular, CalendarLtr24Regular, Chat24Regular, DocumentBulletList24Regular, Mail24Regular, News24Regular, Settings24Regular, TaskListSquareLtr24Regular } from "@fluentui/react-icons";
import type { NavigationKey } from "@yuksalish/contracts";
import { AdaptiveNavigation } from "../src/renderer/AdaptiveNavigation";
import { AiModulesNavigation, groupAiNavigation } from "../src/renderer/AiModulesNavigation";
import { CompanyLogo } from "../src/renderer/CompanyLogo";
import { SlidingSegmented } from "../src/renderer/SlidingSegmented";
import { WorkspaceSectionHeader } from "../src/renderer/WorkspaceSectionHeader";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import { defaultSidebarTheme, type SidebarTheme } from "../src/renderer/sidebar-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-projects-trips.css";
import "../src/renderer/workspace-2-tasks.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/ai-navigation.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/navigation-sliding.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/sidebar-theme.css";

const items = groupAiNavigation([
  { key: "tasks" as NavigationKey, label: "Задачи", icon: <TaskListSquareLtr24Regular /> },
  { key: "ai_referent" as NavigationKey, label: "AI Referent", icon: <Mail24Regular /> },
  { key: "ai_hisobot" as NavigationKey, label: "AI Hisobot", icon: <DocumentBulletList24Regular /> },
  { key: "feed" as NavigationKey, label: "Лента", icon: <News24Regular /> },
  { key: "messenger" as NavigationKey, label: "Мессенджер", icon: <Chat24Regular /> },
  { key: "calendar" as NavigationKey, label: "Календарь", icon: <CalendarLtr24Regular /> },
  { key: "notifications" as NavigationKey, label: "Уведомления", icon: <Alert24Regular /> },
  { key: "payment_requests" as NavigationKey, label: "Заявки на оплату", icon: <DocumentBulletList24Regular /> },
  { key: "settings" as NavigationKey, label: "Настройки", icon: <Settings24Regular /> },
]);

function Preview() {
  const [theme, setTheme] = useState<SidebarTheme>(defaultSidebarTheme);
  const [active, setActive] = useState<NavigationKey>("messenger");
  const [aiOpen, setAiOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [taskView, setTaskView] = useState("Список");
  const [tripView, setTripView] = useState("Текущие поездки");
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <div className={`app-shell${collapsed ? " rail-collapsed" : ""}`}>
      <aside className="app-rail sidebar-palette" data-sidebar-theme={theme} aria-label="Основная навигация">
        <div className="workspace-logo"><button className="rail-toggle" aria-label="Свернуть или развернуть меню" onClick={() => { setCollapsed(!collapsed); setAiOpen(false); }}>☰</button><CompanyLogo tone={theme === "light" ? "color" : "white"} className="rail-brand" /></div>
        <div className="rail-customize"><span>Меню</span></div>
        <AdaptiveNavigation items={items} sidebarTheme={theme} expandedItem={aiOpen && !collapsed ? { key: "ai_modules", height: 101 } : undefined} renderItem={(item, inOverflow, closeOverflow) =>
          <div className="rail-slot" key={item.key}>{item.key === "ai_modules"
            ? <AiModulesNavigation modules={item.modules} activeKey={active} sidebarTheme={theme} inOverflow={inOverflow} inline={!collapsed} open={aiOpen} onOpenChange={setAiOpen} onSelect={setActive} onCloseOverflow={closeOverflow} />
            : <button className={`rail-action${active === item.key ? " active" : ""}`} aria-label={item.label} aria-current={active === item.key ? "page" : undefined} onClick={() => { setActive(item.key); closeOverflow(); }}><span className="rail-icon">{item.icon}</span><span className="rail-label">{item.label}</span></button>}
          </div>} />
        <div className="rail-bottom"><button className="rail-profile"><span className="fui-Avatar">Т</span><span>Тестовый профиль</span></button></div>
      </aside>
      <div className="app-stage"><header className="global-bar"><div role="group" aria-label="Тестовая палитра">{(["blue-teal", "navy", "light"] as const).map(value => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value}</button>)}</div></header>
        <main className="app-content"><section className="workspace-view tasks-view" style={{ padding: 20, overflow: "auto", display: "flex", flexDirection: "column" }}>
          <WorkspaceSectionHeader motif="tasks" className="section-toolbar"><div><h1>Задачи</h1><p>Тестовый стенд: без запросов и записи рабочих данных.</p></div><div className="task-toolbar-actions"><SlidingSegmented className="view-switch" role="group" aria-label="Вид задач">{["Список", "Kanban", "Календарь", "Эффективность"].map(value => <button key={value} className={taskView === value ? "active" : ""} aria-pressed={taskView === value} onClick={() => setTaskView(value)}>{value}</button>)}</SlidingSegmented></div></WorkspaceSectionHeader>
          <WorkspaceSectionHeader motif="trips"><div><h2>Согласование поездок</h2><SlidingSegmented className="process-view-tabs" role="group" aria-label="Разделы поездок">{["Текущие поездки", "Конструктор маршрутов"].map(value => <button key={value} className={tripView === value ? "active" : ""} aria-pressed={tripView === value} onClick={() => setTripView(value)}>{value}</button>)}</SlidingSegmented></div></WorkspaceSectionHeader>
          <p>Активный раздел: {active}. Выбранный вид: {taskView}; {tripView}.</p>
        </section></main>
      </div>
    </div>
  </FluentProvider>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
import.meta.hot?.dispose(() => root.unmount());
