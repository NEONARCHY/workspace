// Real new UI with synthetic requests only; no accounts, messages or real reports.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { FluentProvider } from "@fluentui/react-components";
import type { HisobotActivityDraft, HisobotProfile, HisobotReport, WorkspaceNotification } from "@yuksalish/contracts";
import { AIHisobotView } from "../src/renderer/AIHisobotView";
import { HisobotDraftPrompt, type HisobotDraftHandoff } from "../src/renderer/HisobotDraftPrompt";
import { useQaTheme } from "./color-theme";
import { useBrowserCompactLayout, observeBrowserViewport } from "../src/renderer/browser-layout";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/web-platform.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/ai-hisobot.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/page-canvas.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/browser-secondary.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";
import "../src/renderer/workspace-popups.css";
import "../src/renderer/workspace-field-borders.css";
import "../src/renderer/mobile-density.css";
import "../src/renderer/page-scroll-layout.css";

document.documentElement.classList.add("web-platform");
const empty = new URLSearchParams(location.search).has("empty");
let draft: HisobotActivityDraft = {
  reportDate: "2026-10-21", generatedAt: "2026-10-21T12:40:00Z", seenAt: null,
  activityCount: empty ? 0 : 5, omittedCount: 0,
  content: empty ? "" : "Отчёт за 21.10.2026\n\n1. Завершена задача «Подготовить программу встречи»; результат принят постановщиком.\n2. Подготовлен и отправлен на проверку результат по задаче «Собрать региональную сводку».\n3. Выполнен пункт «Проверить документы» в задаче «Встреча с партнёрами».\n4. Заявка на оплату «Аренда зала»: согласование.\n5. Заявка на поездку «Самарканд — Рабочая встреча»: согласование, стадия «Кадровая служба».",
};
let profile: HisobotProfile = {
  telegramId: "123456789", fullName: "Тестовый Сотрудник", position: "Специалист",
  reportScope: "central", regionName: null, reportRequired: true, managementAccess: false,
  absenceKind: null, today: draft.reportDate, canSubmit: true, windowOpensAt: "12:00",
  windowClosesAt: "21:00", deadlineAt: "18:30", isOverdue: false, todayReport: null,
  activityDraft: draft,
};
const reminder: WorkspaceNotification = {
  id: "qa-reminder", kind: "hisobot", title: "AI Hisobot · черновик отчёта готов", body: "Тестовое напоминание",
  priority: "attention", section: "ai_hisobot", requiresAction: true, isReminder: true,
  occurredAt: draft.generatedAt,
};
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  let result: unknown;
  if (url.pathname.endsWith("/hisobot/me/activity-draft/seen") && init?.method === "POST") {
    draft = { ...draft, seenAt: new Date().toISOString() };
    profile = { ...profile, activityDraft: draft };
    return new Response(null, { status: 204 });
  } else if (url.pathname.endsWith("/hisobot/me/activity-draft")) result = draft;
  else if (url.pathname.endsWith("/hisobot/me")) result = profile;
  else if (url.pathname.endsWith("/hisobot/me/report") && init?.method === "PUT") {
    const body = JSON.parse(String(init.body)) as { content: string };
    const report: HisobotReport = {
      id: "qa-report", userId: "qa", telegramId: profile.telegramId, employeeKey: "qa",
      fullName: profile.fullName, position: profile.position, reportScope: "central", regionName: null,
      reportDate: draft.reportDate, content: body.content, submittedAt: new Date().toISOString(), isLate: false, source: "workspace",
    };
    profile = { ...profile, todayReport: report, coveredByReport: true, activityDraft: null };
    result = report;
    window.dispatchEvent(new Event("qa:report-submitted"));
  } else if (url.pathname.includes("/hisobot/") && url.pathname.endsWith("history")) result = [];
  else throw new Error(`QA blocks unexpected request: ${url.pathname}`);
  return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
};

function Fixture() {
  const theme = useQaTheme();
  const compact = useBrowserCompactLayout(true);
  const [editor, setEditor] = useState(false);
  const [handoff, setHandoff] = useState<HisobotDraftHandoff>();
  const [notifications, setNotifications] = useState<readonly WorkspaceNotification[]>([reminder]);
  useEffect(() => {
    const stop = observeBrowserViewport();
    const submitted = () => setNotifications([]);
    window.addEventListener("qa:report-submitted", submitted);
    return () => { stop(); window.removeEventListener("qa:report-submitted", submitted); };
  }, []);
  return <FluentProvider theme={theme} className="app-provider">
    <div className={`app-shell ${compact ? "browser-compact" : ""}`}>
      <aside className="app-rail"><strong>Workspace</strong><p>Тестовые данные</p><button onClick={() => setEditor(false)}>Главная</button><button onClick={() => setEditor(true)}>AI Hisobot</button></aside>
      <div className="app-stage"><header className="global-bar">Локальная проверка: первый Hisobot reminder. Сервер и реальные отчёты не меняются.</header>
        <HisobotDraftPrompt token="qa" userId="qa" notifications={notifications} enabled editingReport={editor}
          onEdit={value => { setHandoff(value); setEditor(true); }} />
        <main className="app-content" id="workspace-content">
          {editor ? <AIHisobotView token="qa" incomingDraft={handoff} onDraftHandled={() => setHandoff(undefined)} />
            : <section className="workspace-view"><h1>Рабочее пространство</h1><p>Готовый отчёт заметен, даже когда сотрудник находится в другом разделе.</p></section>}
        </main>
      </div>
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
