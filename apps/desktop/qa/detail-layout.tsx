// Read-only QA fixture with real production components and the full CSS order.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { FeedPost, TripRequest } from "@yuksalish/contracts";
import { TasksView } from "../src/renderer/TasksView";
import { AIHisobotView } from "../src/renderer/AIHisobotView";
import { AIReferentIncomingRegister } from "../src/renderer/AIReferentIncomingRegister";
import { TripWorldMap } from "../src/renderer/TripWorldMap";
import { FeedView } from "../src/renderer/FeedView";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { initialTasks, people } from "../src/renderer/test-fixtures/demo-data";
import { useQaTheme } from "./color-theme";
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
const noop = () => undefined;
const task = { ...initialTasks[0]!, title: "Проверка геометрии задачи", authorId: "baxtiyor", assigneeId: "baxtiyor" };
const trip: TripRequest = {
  id: "qa-trip", number: "QA-001", requesterUserId: "baxtiyor", purpose: "Рабочая встреча",
  destination: "Ташкент, Узбекистан", startDate: "2026-10-20", endDate: "2026-10-22",
  employeeIds: ["baxtiyor"], stage: "approved", stageLabel: "Утверждено", status: "approved",
  statusLabel: "Утверждено", canEdit: false, allowedActions: [], actions: [],
  createdAt: "2026-10-15T08:00:00Z", updatedAt: "2026-10-15T08:00:00Z",
};
const post: FeedPost = {
  id: "qa-post", authorUserId: "baxtiyor", title: "Обновление проекта", body: "Проверка действий публикации.",
  isPinned: false, likedByCurrentUser: false, likeCount: 0, reactions: [], comments: [],
  canPin: true, canDelete: true, canEdit: false, createdAt: "2026-10-16T10:00:00Z", updatedAt: "2026-10-16T10:00:00Z",
};
function Fixture() {
  const theme = useQaTheme();
  const view = new URLSearchParams(location.search).get("view");
  return <FluentProvider theme={theme} className="app-provider" style={{ minHeight: "100dvh", color: "var(--ws-text)", background: "var(--ws-canvas)" }}>
    <EmployeeProfileProvider onOpenProfile={noop}><main className="app-content" style={{ height: "100dvh", padding: 16 }}>
      {view === "incoming" ? <section className="ai-referent-view"><AIReferentIncomingRegister token="qa" /></section> :
      view === "trip" ? <TripWorldMap requests={[trip, { ...trip, id: "qa-free", destination: "Термиз 4" }]} people={people} onOpenRequest={noop} onClose={noop} /> :
       view === "hisobot" ? <div style={{ width: "min(100%, 480px)", height: "100%" }}><AIHisobotView token="qa" /></div> :
       view === "feed" ? <FeedView posts={[post]} people={people} token="" currentUserId="baxtiyor" onCreate={async () => post}
         onComment={async () => post} onReact={async () => post} onPin={async () => post} onDelete={async () => true} /> :
       <TasksView tasks={[task]} attachments={[]} people={people} departments={[]} token="qa" currentUserId="baxtiyor" focusTaskId={task.id}
        efficiencyLoading={false} onLoadEfficiency={noop} onCreateTask={noop} onCreateSubtask={noop} onChangeStatus={noop} onUpdateTask={noop} onDeleteTask={() => false}
        onSetParticipant={noop} onRemoveParticipant={noop} onAddChecklistItem={noop} onToggleChecklistItem={noop} onDeleteChecklistItem={noop}
        onAddComment={noop} onSetDependency={noop} onRemoveDependency={noop} onSetCycle={noop} renderTaskChat={() => <div>Чат задачи</div>}
        onReturnForRevision={noop} onSubmitResult={noop} onAcceptResult={noop} onSetEfficiencyExclusion={noop} onExtendDeadline={noop}
        onUploadAttachments={noop} onDownloadAttachment={noop} />}
    </main></EmployeeProfileProvider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
