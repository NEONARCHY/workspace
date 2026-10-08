// Development-only visual fixture: no API calls or real workspace data.
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { Alert24Regular, CalendarLtr24Regular, Chat24Regular, DocumentBulletList24Regular, Mail24Regular, News24Regular, Settings24Regular, TaskListSquareLtr24Regular } from "@fluentui/react-icons";
import type { NavigationKey } from "@yuksalish/contracts";
import { AdaptiveNavigation } from "../src/renderer/AdaptiveNavigation";
import { AiModulesNavigation, groupAiNavigation } from "../src/renderer/AiModulesNavigation";
import { CompanyLogo } from "../src/renderer/CompanyLogo";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/ai-navigation.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/navigation-sliding.css";
import "../src/renderer/sidebar-theme.css";

const items = groupAiNavigation([
  { key: "messenger" as NavigationKey, label: "Мессенджер", icon: <Chat24Regular /> },
  { key: "tasks" as NavigationKey, label: "Задачи", icon: <TaskListSquareLtr24Regular /> },
  { key: "feed" as NavigationKey, label: "Лента", icon: <News24Regular /> },
  { key: "ai_referent" as NavigationKey, label: "AI Referent", icon: <Mail24Regular /> },
  { key: "ai_hisobot" as NavigationKey, label: "AI Hisobot", icon: <DocumentBulletList24Regular /> },
  { key: "calendar" as NavigationKey, label: "Календарь", icon: <CalendarLtr24Regular /> },
  { key: "notifications" as NavigationKey, label: "Уведомления", icon: <Alert24Regular /> },
  { key: "settings" as NavigationKey, label: "Настройки", icon: <Settings24Regular /> },
]);

function Preview() {
  const [active, setActive] = useState<NavigationKey>("ai_referent");
  const [aiOpen, setAiOpen] = useState(false);
  const collapsed = new URLSearchParams(window.location.search).has("collapsed");
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <div className={`app-shell${collapsed ? " rail-collapsed" : ""}`}>
      <aside className="app-rail sidebar-palette" aria-label="Основная навигация">
        <div className="workspace-logo"><span className="rail-toggle" aria-hidden="true">☰</span><CompanyLogo tone="color" className="rail-brand" /></div>
        <div className="rail-customize"><span>Меню</span></div>
        <AdaptiveNavigation items={items} expandedItem={aiOpen && !collapsed ? { key: "ai_modules", height: 101 } : undefined} renderItem={(item, inOverflow, closeOverflow) => item.key === "ai_modules"
          ? <div className="rail-slot" key={item.key}><AiModulesNavigation modules={item.modules} activeKey={active} inOverflow={inOverflow} inline={!collapsed} open={aiOpen} onOpenChange={setAiOpen} onCloseOverflow={closeOverflow} onSelect={setActive} /></div>
          : <div className="rail-slot" key={item.key}><button type="button" className={`rail-action${active === item.key ? " active" : ""}`} onClick={() => setActive(item.key)}>
            <span className="rail-icon">{item.icon}</span><span className="rail-label">{item.label}</span></button></div>}
        />
        <div className="rail-bottom"><button type="button" className="rail-profile"><span className="fui-Avatar">П</span><span>Профиль</span></button></div>
      </aside>
      <div className="app-stage"><header className="global-bar" /><main className="app-content"><section className="workspace-view" style={{ padding: 28 }}><h1>Предпросмотр навигации</h1><p>Активный раздел: {active}</p></section></main></div>
    </div>
  </FluentProvider>;
}

flushSync(() => createRoot(document.getElementById("root")!).render(<Preview />));
document.querySelector<HTMLButtonElement>(".rail-ai-trigger")?.click();
