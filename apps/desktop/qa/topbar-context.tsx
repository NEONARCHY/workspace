import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { TopbarInsights } from "../src/renderer/TopbarInsights";
import { ConnectionIndicator, WorkspaceIdentity } from "../src/renderer/WorkspaceIdentity";
import { WorkdayControl } from "../src/renderer/WorkdayControl";
import { YuksalishAssistant } from "../src/renderer/YuksalishAssistant";
import { SectionJump } from "../src/renderer/SectionJump";
import { NotificationBell } from "../src/renderer/NotificationBell";
import { ColorThemeToggle } from "../src/renderer/ColorThemeToggle";
import { DialogResizeMotion } from "../src/renderer/DialogResizeMotion";
import { useBrowserCompactLayout } from "../src/renderer/browser-layout";
import { Navigation24Regular } from "@fluentui/react-icons";
import { useQaTheme } from "./color-theme";
import { contextRates, contextWeather } from "./context-fixtures";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/context-colors.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-composer.css";
import "../src/renderer/motion.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/employee-recognition.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/desktop-updates.css";
import "../src/renderer/web-platform.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/assistant-chat.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/accent-surfaces.css";
import "../src/renderer/list-row-hover.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/sidebar-theme.css";
import "../src/renderer/page-canvas.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";
import "../src/renderer/workspace-search.css";
import "../src/renderer/workspace-popups.css";
import "../src/renderer/workspace-field-borders.css";
import "../src/renderer/workspace-select-motion.css";
import "../src/renderer/workspace-modal-backdrops.css";
import "../src/renderer/notification-bell.css";
import "../src/renderer/topbar-insights.css";
import "../src/renderer/mobile-density.css";
// Local synthetic responses; no live mutations or employee accounts.
document.documentElement.classList.add("web-platform");
const state = new URLSearchParams(location.search).get("state");
window.fetch = async input => {
  const url = String(input);
  let data: unknown = {};
  if (url.includes("/context/exchange-rates")) data = { ...contextRates, stale: state === "stale" };
  if (url.includes("/context/weather")) data = state === "air-unavailable" ? { ...contextWeather, airStale: true, locations: contextWeather.locations.map(place => ({ ...place, air: null })) } : contextWeather;
  if (url.includes("/workday/me")) data = { status: "not_started", schedule: { startsAt: "09:00", endsAt: "18:00" } };
  return new Response(JSON.stringify(state === "error" && url.includes("/context/") ? { detail: "Источник временно недоступен" } : data), { status: state === "error" && url.includes("/context/") ? 503 : 200, headers: { "content-type": "application/json" } });
};
function OpeningProbe() {
  const [result, setResult] = useState("");
  useEffect(() => {
    const seen = new WeakSet<Element>();
    let frame = 0;
    const observe = new MutationObserver(() => {
      const panel = document.querySelector<HTMLElement>(".topbar-context-surface");
      if (!panel || seen.has(panel)) return;
      seen.add(panel);
      const started = performance.now();
      const samples: { time: number; height: number; overflow: number; resizing: boolean }[] = [];
      cancelAnimationFrame(frame);
      const sample = () => {
        const body = panel.querySelector<HTMLElement>(".context-panel-body")!;
        samples.push({ time: Math.round(performance.now() - started), height: panel.clientHeight,
          overflow: body.scrollHeight - body.clientHeight, resizing: panel.dataset.surfaceResizing === "true" });
        if (panel.isConnected && performance.now() - started < 600) frame = requestAnimationFrame(sample);
        else setResult(JSON.stringify(samples));
      };
      sample();
    });
    observe.observe(document.body, { childList: true, subtree: true });
    return () => { observe.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <output aria-label="Замер открытия" style={{ position: "fixed", left: 0, bottom: 0, maxWidth: "100vw", maxHeight: 40, overflow: "auto", fontSize: 9 }}>{result}</output>;
}
function Fixture() {
  const theme = useQaTheme();
  const compact = useBrowserCompactLayout(true);
  return <FluentProvider theme={theme} className="app-provider"><DialogResizeMotion />
    {new URLSearchParams(location.search).has("measureOpening") && <OpeningProbe />}
    <div className={`app-shell ${compact ? "browser-compact" : ""}`} style={{ display: "block", padding: compact ? 12 : 24 }}><div className="app-stage" style={{ marginLeft: compact ? 0 : 230 }}>
      <header className="global-bar">
        {compact && <button className="browser-menu-trigger" aria-label="Открыть меню"><Navigation24Regular /></button>}
        <SectionJump items={[]} onNavigate={() => {}} />
        <div className="workspace-top-context"><div className="workspace-workday-status">
          <ConnectionIndicator detail="Сервер доступен" error={false} updateAvailable /><TopbarInsights token="qa" />
        </div><NotificationBell unreadCount={1} active={false} onOpen={() => {}} /><ColorThemeToggle userId="qa-theme" />
          {new URLSearchParams(location.search).has("assistant") && <YuksalishAssistant token="qa" />}
          <div className="workspace-workday-person"><WorkdayControl token="qa" />
          <WorkspaceIdentity person={{ id: "qa", username: "qa", name: "Сотрудник", initials: "ТС", role: "employee", color: "brand" }} token="qa" onSupport={() => {}} onSettings={() => {}} onLogout={() => {}} supportMode="support" /></div>
        </div>
      </header>
      <main style={{ padding: 16, color: "var(--ws-theme-muted)" }}>Тестовые данные. Настоящие компоненты верхней панели; сервер и записи сотрудников не меняются.</main>
    </div></div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
