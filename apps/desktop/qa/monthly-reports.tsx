// Synthetic data only. The smoke runner intercepts every API call and blocks outside traffic.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { MonthlyReportDashboard, MonthlyReportsView } from "../src/renderer/MonthlyReportsView";
import { useMonthlyReports, useMonthlyReportWindow } from "../src/renderer/useMonthlyReports";
import { workspaceTheme, workspaceDarkTheme } from "../src/renderer/workspace-theme";

import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/context-colors.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-composer.css";
import "../src/renderer/motion.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/members.css";
import "../src/renderer/employee-recognition.css";
import "../src/renderer/hr.css";
import "../src/renderer/ai-referent.css";
import "../src/renderer/zoom.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/forwarding.css";
import "../src/renderer/team-dashboard.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-payments.css";
import "../src/renderer/workspace-2-workflow.css";
import "../src/renderer/workspace-2-projects-trips.css";
import "../src/renderer/trip-documents.css";
import "../src/renderer/trip-map.css";
import "../src/renderer/workspace-2-tasks.css";
import "../src/renderer/task-plans.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/ai-navigation.css";
import "../src/renderer/workspace-2-auth.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-2-notifications.css";
import "../src/renderer/support-dialog.css";
import "../src/renderer/calendar-event-composer.css";
import "../src/renderer/desktop-updates.css";
import "../src/renderer/window-titlebar.css";
import "../src/renderer/web-platform.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/project-hub.css";
import "../src/renderer/ai-referent-workspace.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/ai-hisobot.css";
import "../src/renderer/telegram-access.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/accent-surfaces.css";
import "../src/renderer/list-row-hover.css";
import "../src/renderer/workspace-calendar.css";
import "../src/renderer/confirm-action-dialog.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/presence-summary-dialog.css";
import "../src/renderer/assistant-chat.css";
import "../src/renderer/account-settings.css";
import "../src/renderer/profile-header.css";
import "../src/renderer/project-workspace.css";
import "../src/renderer/sidebar-visibility.css";
import "../src/renderer/navigation-sliding.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/sidebar-theme.css";
import "../src/renderer/page-canvas.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/browser-secondary.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";
import "../src/renderer/workspace-search.css";
import "../src/renderer/workspace-popups.css";
import "../src/renderer/chat-delete-dialog.css";
import "../src/renderer/workspace-field-borders.css";
import "../src/renderer/task-composer-sections.css";
import "../src/renderer/messenger-outgoing.css";
import "../src/renderer/messenger-voice.css";
import "../src/renderer/workspace-select-motion.css";
import "../src/renderer/workspace-modal-backdrops.css";
import "../src/renderer/notification-bell.css";
import "../src/renderer/topbar-insights.css";
import "../src/renderer/mobile-density.css";
import "../src/renderer/page-scroll-layout.css";
import "../src/renderer/floating-messenger.css";

function Fixture() {
  const params = new URLSearchParams(location.search);
  const dark = params.has("dark");
  const page = params.has("page");
  const resource = useMonthlyReports("synthetic-monthly-qa", true);
  const window = useMonthlyReportWindow("synthetic-user");
  return <FluentProvider theme={dark ? workspaceDarkTheme : workspaceTheme}>
    <main style={{ padding: 20, minHeight: "100vh", background: dark ? "#202327" : "#eaf2f0" }}>
      <h1>Синтетический обзор команды</h1>
      <MonthlyReportDashboard resource={resource} onOpen={launcher => { document.documentElement.dataset.monthlyLauncher = launcher?.tagName; window.show(launcher); }} />
      {page ? <MonthlyReportsView token="synthetic-monthly-qa" resource={resource} />
        : <MonthlyReportsView token="synthetic-monthly-qa" resource={resource} open={window.open} onClose={window.hide} onAfterClose={closed => { document.documentElement.dataset.monthlyClosed = "yes"; window.afterClose(closed); }} />}
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
