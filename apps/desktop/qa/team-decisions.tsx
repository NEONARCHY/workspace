// Synthetic fixture: all API traffic is intercepted by the smoke runner.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { TeamDashboardView } from "../src/renderer/TeamDashboardView";
import { workspaceDarkTheme, workspaceTheme } from "../src/renderer/workspace-theme";
import { AIReferentView } from "../src/renderer/AIReferentView";
import { LeaveView } from "../src/renderer/LeaveView";
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
const params = new URLSearchParams(location.search);
const dark = params.has("dark");
const leave = params.get("kind") === "leaves";
document.documentElement.dataset.colorTheme = dark ? "dark" : "light";
const people = [{ id: "qa-reviewer", name: "Тестовый руководитель", role: "manager" as const, initials: "ТР", color: "#0091A8" },
  { id: "qa-author", name: "Тестовый сотрудник", role: "employee" as const, initials: "ТС", color: "#293A55" }];
function Fixture() {
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  const trigger = useRef<HTMLElement | null>(null);
  const close = () => {
    setSelected(""); setRevision(value => value + 1);
    window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  return <FluentProvider theme={dark ? workspaceDarkTheme : workspaceTheme}>
    <main className="signature-qa">
      <TeamDashboardView token="synthetic-token" currentUserId="qa-reviewer" tasks={[]} people={people}
        decisionRevision={revision} onDecisionOpen={target => { trigger.current = target; }}
        efficiencyLoading={false} onSelectTask={() => undefined}
        onSelectSignatureLetter={leave ? undefined : setSelected} onSelectLeave={leave ? setSelected : undefined} />
      {selected ? leave
        ? <LeaveView key={selected} token="synthetic-token" people={people} currentUserId="qa-reviewer" canCreate={false} dialogOnly focusRequestId={selected} onDialogClose={close} />
        : <AIReferentView key={selected} token="synthetic-token" people={people} canCreate={false} dialogOnly focusRequestId={selected} onDialogClose={close} />
      : null}
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
