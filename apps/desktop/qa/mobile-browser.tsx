// Synthetic fixture for actual shell components. Business requests are intercepted by QA.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, Button } from "@fluentui/react-components";
import { Chat24Regular, Navigation24Regular, TaskListSquareLtr24Regular, Mail24Regular, DocumentBulletList24Regular } from "@fluentui/react-icons";
import type { NavigationKey } from "@yuksalish/contracts";
import { BrowserNavigation } from "../src/renderer/BrowserNavigation";
import { useBrowserCompactLayout, observeBrowserViewport } from "../src/renderer/browser-layout";
import { AdaptiveNavigation } from "../src/renderer/AdaptiveNavigation";
import { groupAiNavigation, AiModulesNavigation } from "../src/renderer/AiModulesNavigation";
import { SectionJump } from "../src/renderer/SectionJump";
import { WorkdayControl } from "../src/renderer/WorkdayControl";
import { WorkspaceIdentity, ConnectionIndicator } from "../src/renderer/WorkspaceIdentity";
import { YuksalishAssistant } from "../src/renderer/YuksalishAssistant";
import { CompanyLogo } from "../src/renderer/CompanyLogo";
import { WorkspaceSectionHeader } from "../src/renderer/WorkspaceSectionHeader";
import { useQaTheme } from "./color-theme";
import { ColorThemeToggle } from "../src/renderer/ColorThemeToggle";
import { defaultSidebarTheme } from "../src/renderer/sidebar-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/ai-navigation.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/navigation-sliding.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/sidebar-theme.css";
import "../src/renderer/page-canvas.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/assistant-chat.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/browser-secondary.css";

const sections = ["Главная", "Мессенджер", "Задачи", "Заявки на оплату", "Лента", "Календарь", "Сотрудники", "Проекты", "Проектные заявки", "Согласование поездок", "Отсутствия", "Zoom-конференции", "Работа с членами", "Уведомления", "Входящие письма", "Аналитика опросов", "HR", "Настройки"];
const keys: NavigationKey[] = ["home", "messenger", "tasks", "payment_requests", "feed", "calendar", "employees", "project_hub", "project_funding", "trip_approvals", "absences", "zoom_meetings", "members", "notifications", "incoming_letters", "survey_analytics", "hr", "settings"];
const entries = sections.map((label, index) => ({ key: keys[index]!, label, icon: index === 1 ? <Chat24Regular /> : <TaskListSquareLtr24Regular /> }));
entries.splice(6, 0, { key: "ai_referent", label: "AI Referent", icon: <Mail24Regular /> }, { key: "ai_hisobot", label: "AI Hisobot", icon: <DocumentBulletList24Regular /> });
const menuItems = groupAiNavigation(entries);
const person = { id: "mobile-qa", name: "Тестовый сотрудник с длинным именем", initials: "ТС", role: "employee" as const, color: "#0091a8" };

function Fixture() {
  const workspaceTheme = useQaTheme();
  const compact = useBrowserCompactLayout(true);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [ai, setAi] = useState(false);
  const [active, setActive] = useState<NavigationKey>("tasks");
  useEffect(() => { document.documentElement.classList.add("web-platform"); return observeBrowserViewport(); }, []);
  const select = (key: NavigationKey) => { setActive(key); setOpen(false); if (compact) setAi(false); };
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <div className={`app-shell${compact ? " browser-compact" : ""}`}>
      <BrowserNavigation compact={compact} open={open} returnFocusRef={trigger} onOpenChange={setOpen}>
        <aside className="app-rail sidebar-palette" data-sidebar-theme={defaultSidebarTheme} aria-label="Основная навигация">
          <div className="workspace-logo"><button className="rail-toggle" aria-label="Закрыть меню" onClick={() => setOpen(false)}><Navigation24Regular /></button><CompanyLogo tone="white" className="rail-brand" /></div>
          <div className="rail-customize"><span>Меню</span></div>
          <AdaptiveNavigation items={menuItems} scrollable={compact} expandedItem={ai ? { key: "ai_modules", height: 101 } : undefined} renderItem={(item, overflow, closeOverflow) => <div className="rail-slot" key={item.key}>{item.key === "ai_modules" ? <AiModulesNavigation modules={item.modules} activeKey={active} inline open={ai} onOpenChange={setAi} inOverflow={overflow} onSelect={select} onCloseOverflow={closeOverflow} /> : <button className={`rail-action${active === item.key ? " active" : ""}`} aria-current={active === item.key ? "page" : undefined} onClick={() => { select(item.key); closeOverflow(); }}><span className="rail-icon">{item.icon}</span><span className="rail-label">{item.label}</span></button>}</div>} />
          <div className="rail-bottom"><button className="rail-profile" onClick={() => setOpen(false)}><span>{person.name}</span></button></div>
        </aside>
      </BrowserNavigation>
      <div className="app-stage"><header className="global-bar">
        {compact ? <button ref={trigger} className="browser-menu-trigger" aria-label="Открыть меню" aria-expanded={open} aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setOpen(true); }}><Navigation24Regular /></button> : null}
        <SectionJump items={entries} onNavigate={select} />
        <div className="workspace-top-context"><ConnectionIndicator detail="Тестовый сервер" error={false} /><WorkdayControl token="synthetic-only" /><ColorThemeToggle userId="qa-theme" /><YuksalishAssistant token="synthetic-only" onOpenReference={() => undefined} /><WorkspaceIdentity token="synthetic-only" person={person} onSupport={() => undefined} supportMode="support" onSettings={() => select("settings")} onLogout={() => undefined} /></div>
      </header>
      <main className="app-content" id="workspace-content" tabIndex={-1}><section className="workspace-view" style={{ display: "flex", flexDirection: "column", overflow: "auto" }}>
        <WorkspaceSectionHeader motif="tasks" className="section-toolbar"><div><h1>{entries.find(item => item.key === active)?.label ?? active}</h1><p>Проверка оболочки · без рабочих данных</p></div><Button>Создать запись</Button></WorkspaceSectionHeader>
        <label style={{ padding: 16 }}>Черновик<textarea aria-label="Черновик" style={{ width: "100%", minHeight: 120 }} /></label>
        <p style={{ padding: 16 }}>Содержимое этой тестовой страницы сохраняет ввод при открытии меню и изменении размеров. Списки и формы отдельных модулей проверяются следующими этапами.</p>
      </section></main></div>
    </div>
  </FluentProvider>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());
