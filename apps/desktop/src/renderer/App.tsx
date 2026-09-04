import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type {
  ApprovalRequestSummary,
  AuthenticationSession,
  CalendarEvent,
  CalendarEventInput,
  ChatMessage,
  FeedPost,
  NotificationPreferences,
  ProjectInput,
  ProjectStage,
  TaskStatus,
  TripAction,
  TripRequest,
  TripRequestInput,
  WorkflowDefinition,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceProject,
  WorkspaceNotification,
  WorkflowPosition,
  WorkspaceSection,
  WorkspaceTask,
} from "@yuksalish/contracts";
import {
  Avatar,
  Button,
  FluentProvider,
  Input,
  webLightTheme,
} from "@fluentui/react-components";
import {
  Alert24Regular,
  ApprovalsApp24Regular,
  Building24Regular,
  CalendarLtr24Regular,
  Chat24Filled,
  Chat24Regular,
  DocumentBulletList24Regular,
  FolderPeople24Regular,
  Navigation24Regular,
  News24Regular,
  PeopleTeam24Regular,
  Search24Regular,
  Settings24Regular,
  TaskListSquareLtr24Filled,
  TaskListSquareLtr24Regular,
} from "@fluentui/react-icons";

import { AccountPanel } from "./AccountPanel";
import { ApprovalsView } from "./ApprovalsView";
import { CalendarView } from "./CalendarView";
import { initialChats, initialMessages, initialTasks, people } from "./demo-data";
import { EmployeesView } from "./EmployeesView";
import { FeedView } from "./FeedView";
import { LoginView } from "./LoginView";
import { MessengerView } from "./MessengerView";
import { NotificationCenter } from "./NotificationCenter";
import { ProjectsView } from "./ProjectsView";
import { TasksView } from "./TasksView";
import { TripApprovalsView } from "./TripApprovalsView";
import {
  acceptInvitation,
  actOnWorkspaceTripRequest,
  actOnWorkspaceApproval,
  addWorkspaceTaskChecklistItem,
  addWorkspaceTaskComment,
  changeWorkspaceTaskStatus,
  changeWorkspaceProjectStage,
  cancelWorkspaceCalendarEvent,
  completePasswordReset,
  createWorkspaceApproval,
  createWorkspaceCalendarEvent,
  createWorkspaceFeedPost,
  createWorkspaceProject,
  createWorkspaceTask,
  createWorkspaceTripRequest,
  deleteWorkspaceTaskChecklistItem,
  downloadWorkspaceAttachment,
  loadWorkspace,
  login,
  logout,
  markAllWorkspaceNotificationsRead,
  markWorkspaceNotificationDesktopDelivered,
  markWorkspaceNotificationRead,
  markWorkspaceChatRead,
  pinWorkspaceFeedPost,
  refreshAuthentication,
  removeWorkspaceTaskDependency,
  removeWorkspaceTaskParticipant,
  publishWorkspaceWorkflow,
  saveWorkspaceWorkflow,
  sendWorkspaceMessage,
  setWorkspaceFeedLike,
  setWorkspaceTaskCycle,
  setWorkspaceTaskDependency,
  setWorkspaceTaskParticipant,
  subscribeToWorkspaceEvents,
  updateWorkspaceApproval,
  updateWorkspaceCalendarEvent,
  updateWorkspaceProject,
  updateWorkspaceTask,
  updateWorkspaceTripRequest,
  updateWorkspaceNotificationPreferences,
  toggleWorkspaceTaskChecklistItem,
  uploadWorkspaceAttachment,
  addWorkspaceFeedComment,
  type PaymentRequestInput,
} from "./workspace-api";

interface NavItem {
  readonly key: WorkspaceSection;
  readonly label: string;
  readonly icon: ReactNode;
}

interface WorkspaceState {
  readonly currentUser: WorkspacePerson;
  readonly canCreatePaymentRequests: boolean;
  readonly people: readonly WorkspacePerson[];
  readonly positions: readonly WorkflowPosition[];
  readonly chats: typeof initialChats;
  readonly messages: readonly ChatMessage[];
  readonly tasks: readonly WorkspaceTask[];
  readonly requests: readonly ApprovalRequestSummary[];
  readonly projects: readonly WorkspaceProject[];
  readonly tripRequests: readonly TripRequest[];
  readonly feedPosts: readonly FeedPost[];
  readonly calendarEvents: readonly CalendarEvent[];
  readonly notifications: readonly WorkspaceNotification[];
  readonly notificationPreferences: NotificationPreferences;
  readonly attachments: readonly WorkspaceAttachment[];
  readonly workflow?: WorkflowDefinition;
}

const initialWorkspace: WorkspaceState = {
  currentUser: people[0]!,
  canCreatePaymentRequests: true,
  people,
  positions: [],
  chats: initialChats,
  messages: initialMessages,
  tasks: initialTasks,
  requests: [],
  projects: [],
  tripRequests: [],
  feedPosts: [],
  calendarEvents: [],
  notifications: [],
  notificationPreferences: {
    desktopEnabled: true,
    messagesEnabled: true,
    tasksEnabled: true,
    approvalsEnabled: true,
    tripsEnabled: true,
    calendarEnabled: true,
    remindersEnabled: true,
  },
  attachments: [],
};

const navItems: readonly NavItem[] = [
  { key: "crm", label: "CRM", icon: <Building24Regular /> },
  {
    key: "tasks",
    label: "Задачи",
    icon: <TaskListSquareLtr24Regular />,
  },
  {
    key: "payment_requests",
    label: "Заявки на оплату",
    icon: <DocumentBulletList24Regular />,
  },
  { key: "feed", label: "Лента", icon: <News24Regular /> },
  { key: "projects", label: "Список проектов", icon: <FolderPeople24Regular /> },
  {
    key: "trip_approvals",
    label: "Согласование поездок",
    icon: <ApprovalsApp24Regular />,
  },
  {
    key: "messenger",
    label: "Мессенджер",
    icon: <Chat24Regular />,
  },
  { key: "calendar", label: "Календарь", icon: <CalendarLtr24Regular /> },
  { key: "employees", label: "Сотрудники", icon: <PeopleTeam24Regular /> },
];

interface ModulePreviewProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly evidence: string;
  readonly packageLabel: string;
}

function ModulePreview({ icon, title, evidence, packageLabel }: ModulePreviewProps) {
  return (
    <section className="workspace-view parity-preview" aria-label={title}>
      <div className="parity-preview-card">
        <span className="parity-preview-icon">{icon}</span>
        <span className="parity-kicker">Вкладка закреплена в общей навигации</span>
        <h1>{title}</h1>
        <p>{evidence}</p>
        <div>
          <strong>{packageLabel}</strong>
          <span>Функции будут подключаться вертикальным срезом по зафиксированной Bitrix‑спецификации.</span>
        </div>
      </div>
    </section>
  );
}

function readableAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Не удалось войти";
  const messages: Record<string, string> = {
    "Invalid username or password": "Неверный логин или пароль.",
    "TOTP code required": "Введите шестизначный код приложения-аутентификатора.",
    "Invalid or already used TOTP code": "Код неверный или уже использован.",
    "Account is temporarily locked": "Слишком много попыток. Вход временно заблокирован.",
    "Invitation was not found": "Приглашение не найдено.",
    "Invitation is no longer active": "Приглашение уже использовано или отозвано.",
    "Invitation has expired": "Срок действия приглашения истёк.",
  };
  return messages[message] ?? message;
}

export function App() {
  const [activeSection, setActiveSection] = useState<WorkspaceSection | "notifications">("messenger");
  const [connectionDetail, setConnectionDetail] = useState("Сервер подключён");
  const [session, setSession] = useState<AuthenticationSession>();
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{
    section: WorkspaceSection; entityId?: string; revision: number;
  }>();
  const knownNotificationIds = useRef<Set<string> | null>(null);

  const refreshWorkspace = useCallback(async (accessToken: string) => {
    const loaded = await loadWorkspace(accessToken);
    setWorkspace(loaded);
  }, []);

  const establishSession = async (authenticated: AuthenticationSession) => {
    const loaded = await loadWorkspace(authenticated.accessToken);
    knownNotificationIds.current = new Set(loaded.notifications.map((item) => item.id));
    setFocusTarget(undefined);
    setWorkspace(loaded);
    setSession(authenticated);
    setConnectionDetail("Сервер подключён");
    setAuthError(undefined);
  };

  const handleLogin = async (username: string, password: string, totpCode?: string) => {
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      await establishSession(await login(username, password, totpCode));
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAcceptInvitation = async (inviteToken: string, password: string) => {
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      await establishSession(await acceptInvitation(inviteToken, password));
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCompletePasswordReset = async (resetToken: string, password: string) => {
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      await establishSession(await completePasswordReset(resetToken, password));
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    const current = session;
    setAccountOpen(false);
    setSession(undefined);
    setAuthError(undefined);
    knownNotificationIds.current = null;
    if (current !== undefined) {
      await logout(current.accessToken).catch(() => undefined);
    }
  };

  const reportError = (error: unknown) => {
    setConnectionDetail(error instanceof Error ? error.message : "Ошибка операции");
  };

  useEffect(() => {
    if (session === undefined) return;
    const refreshAfter = Math.max(60_000, (session.expiresIn - 60) * 1_000);
    const timer = window.setTimeout(() => {
      void refreshAuthentication(session.refreshToken)
        .then(async (renewed) => {
          await refreshWorkspace(renewed.accessToken);
          setSession(renewed);
        })
        .catch(() => {
          setSession(undefined);
          setAuthError("Сессия завершена. Войдите снова.");
        });
    }, refreshAfter);
    return () => window.clearTimeout(timer);
  }, [refreshWorkspace, session]);

  useEffect(() => {
    if (session === undefined) return;
    const known = knownNotificationIds.current;
    if (known === null) {
      knownNotificationIds.current = new Set(workspace.notifications.map((item) => item.id));
      return;
    }
    const preferences = workspace.notificationPreferences;
    const kindEnabled: Record<WorkspaceNotification["kind"], boolean> = {
      message: preferences.messagesEnabled,
      task: preferences.tasksEnabled,
      approval: preferences.approvalsEnabled,
      trip: preferences.tripsEnabled,
      calendar: preferences.calendarEnabled,
    };
    for (const notification of workspace.notifications) {
      if (known.has(notification.id)) continue;
      known.add(notification.id);
      if (
        !preferences.desktopEnabled
        || !kindEnabled[notification.kind]
        || (notification.isReminder && !preferences.remindersEnabled)
        || notification.desktopDeliveredAt
        || notification.readAt
      ) continue;
      void window.yuksalish?.showNotification({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        section: notification.section,
        entityId: notification.entityId ?? undefined,
      }).then((shown) => {
        if (!shown) return;
        void markWorkspaceNotificationDesktopDelivered(
          session.accessToken,
          notification.id,
        ).then((delivered) => {
          setWorkspace((current) => ({
            ...current,
            notifications: current.notifications.map((item) =>
              item.id === delivered.id ? delivered : item,
            ),
          }));
        }).catch(reportError);
      }).catch(reportError);
    }
  }, [session, workspace.notificationPreferences, workspace.notifications]);

  useEffect(() => {
    if (session === undefined) return;
    return subscribeToWorkspaceEvents(session.accessToken, () => {
      void refreshWorkspace(session.accessToken);
    });
  }, [refreshWorkspace, session]);

  const uploadFiles = async (
    ownerType: "message" | "task" | "approval_request",
    ownerId: string,
    files: readonly File[],
    documentRole: "general" | "primary" | "additional" = "general",
  ) => {
    if (session === undefined || files.length === 0) return [];
    const uploaded: WorkspaceAttachment[] = [];
    for (const file of files) {
      const attachment = await uploadWorkspaceAttachment(
        session.accessToken,
        ownerType,
        ownerId,
        file,
        documentRole,
      );
      uploaded.push(attachment);
      setWorkspace((current) => ({
        ...current,
        attachments: [...current.attachments, attachment],
      }));
    }
    return uploaded;
  };

  const handleDownloadAttachment = async (attachment: WorkspaceAttachment) => {
    if (session === undefined) return;
    try {
      const blob = await downloadWorkspaceAttachment(session.accessToken, attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      reportError(error);
    }
  };

  const handleSendMessage = async (chatId: string, body: string, files: readonly File[]) => {
    if (session === undefined) return undefined;
    try {
      const message = await sendWorkspaceMessage(session.accessToken, chatId, body);
      setWorkspace((current) =>
        current.messages.some((item) => item.id === message.id)
          ? current
          : { ...current, messages: [...current.messages, message] },
      );
      await uploadFiles("message", message.id, files);
      return message;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleMarkChatRead = async (chatId: string) => {
    if (session === undefined) return;
    try {
      await markWorkspaceChatRead(session.accessToken, chatId);
      setWorkspace((current) => ({
        ...current,
        chats: current.chats.map((chat) => chat.id === chatId ? { ...chat, unread: 0 } : chat),
      }));
    } catch (error) {
      reportError(error);
    }
  };

  const handleCreateTask = async (title: string) => {
    if (session === undefined) return undefined;
    try {
      const task = await createWorkspaceTask(session.accessToken, {
        title,
        assigneeId: workspace.currentUser.id,
      });
      setWorkspace((current) => ({ ...current, tasks: [task, ...current.tasks] }));
      return task;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateTaskFromMessage = async (message: ChatMessage, title: string) => {
    if (session === undefined) return undefined;
    try {
      const task = await createWorkspaceTask(session.accessToken, {
        title,
        assigneeId: workspace.currentUser.id,
        sourceMessageId: message.id,
      });
      setWorkspace((current) => ({ ...current, tasks: [task, ...current.tasks] }));
      setActiveSection("tasks");
      setConnectionDetail("Задача создана из сообщения");
      return task;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleTaskStatus = async (taskId: string, status: TaskStatus) => {
    if (session === undefined) return;
    try {
      const task = await changeWorkspaceTaskStatus(session.accessToken, taskId, status);
      setWorkspace((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
      }));
    } catch (error) {
      reportError(error);
    }
  };

  const mergeTask = (task: WorkspaceTask) => {
    setWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
    }));
    return task;
  };

  const runTaskMutation = async (
    mutation: (token: string) => Promise<WorkspaceTask>,
  ): Promise<WorkspaceTask | undefined> => {
    if (session === undefined) return undefined;
    try {
      return mergeTask(await mutation(session.accessToken));
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleUpdateTask = (
    task: WorkspaceTask,
    payload: {
      readonly title: string;
      readonly description: string;
      readonly project: string;
      readonly assigneeId: string;
      readonly priority: WorkspaceTask["priority"];
      readonly dueAt?: string | null;
    },
  ) => runTaskMutation((token) => updateWorkspaceTask(token, task.id, payload));

  const handleSetTaskParticipant = (
    task: WorkspaceTask,
    userId: string,
    role: "co_assignee" | "observer",
  ) => runTaskMutation((token) => setWorkspaceTaskParticipant(token, task.id, userId, role));

  const handleRemoveTaskParticipant = (task: WorkspaceTask, userId: string) =>
    runTaskMutation((token) => removeWorkspaceTaskParticipant(token, task.id, userId));

  const handleAddChecklistItem = (task: WorkspaceTask, title: string) =>
    runTaskMutation((token) => addWorkspaceTaskChecklistItem(token, task.id, title));

  const handleToggleChecklistItem = (
    task: WorkspaceTask,
    itemId: string,
    completed: boolean,
  ) => runTaskMutation((token) =>
    toggleWorkspaceTaskChecklistItem(token, task.id, itemId, completed));

  const handleDeleteChecklistItem = (task: WorkspaceTask, itemId: string) =>
    runTaskMutation((token) => deleteWorkspaceTaskChecklistItem(token, task.id, itemId));

  const handleAddTaskComment = (task: WorkspaceTask, body: string) =>
    runTaskMutation((token) => addWorkspaceTaskComment(token, task.id, body));

  const handleSetTaskDependency = (
    task: WorkspaceTask,
    dependsOnTaskId: string,
    dependencyKind: "blocks" | "relates",
  ) => runTaskMutation((token) =>
    setWorkspaceTaskDependency(token, task.id, dependsOnTaskId, dependencyKind));

  const handleRemoveTaskDependency = (task: WorkspaceTask, dependsOnTaskId: string) =>
    runTaskMutation((token) =>
      removeWorkspaceTaskDependency(token, task.id, dependsOnTaskId));

  const handleSetTaskCycle = (
    task: WorkspaceTask,
    payload: {
      readonly title: string;
      readonly scheduleKind: "daily" | "weekly" | "monthly";
      readonly interval: number;
      readonly nextRunAt?: string | null;
      readonly isEnabled: boolean;
    },
  ) => runTaskMutation((token) => setWorkspaceTaskCycle(token, task.id, payload));

  const handleSaveWorkflow = async (workflow: WorkflowDefinition) => {
    if (session === undefined) return;
    const saved = await saveWorkspaceWorkflow(session.accessToken, workflow);
    setWorkspace((current) => ({ ...current, workflow: saved }));
  };

  const handlePublishWorkflow = async (workflow: WorkflowDefinition) => {
    if (session === undefined) return undefined;
    try {
      const nextDraft = await publishWorkspaceWorkflow(session.accessToken, workflow.id);
      setWorkspace((current) => ({ ...current, workflow: nextDraft }));
      setConnectionDetail(`Маршрут версии ${workflow.version} опубликован`);
      return nextDraft;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateApproval = async (
    payload: PaymentRequestInput,
    primaryFiles: readonly File[] = [],
    additionalFiles: readonly File[] = [],
  ) => {
    if (session === undefined) return undefined;
    try {
      const request = await createWorkspaceApproval(session.accessToken, payload);
      setWorkspace((current) => ({ ...current, requests: [request, ...current.requests] }));
      await uploadFiles("approval_request", request.id, primaryFiles, "primary");
      await uploadFiles("approval_request", request.id, additionalFiles, "additional");
      if (primaryFiles.length + additionalFiles.length > 0) {
        await refreshWorkspace(session.accessToken);
      }
      return request;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateApprovalFromTask = async (
    task: WorkspaceTask,
    title: string,
    amount: number,
  ) => {
    const request = await handleCreateApproval({
      title,
      amount,
      currency: "UZS",
      purpose: task.title,
      sourceTaskId: task.id,
      projectName: task.project,
      projectCode: "",
      sourceAccount: "",
      destinationAccount: "",
      requestPriority: task.priority === "urgent" ? "urgent" : "normal",
      deadline: task.dueAt,
      comment: `Создано из задачи: ${task.title}`,
      tripPurpose: "",
      employeeIds: [task.assigneeId],
      paymentReason: task.title,
      responsibleUserId: task.assigneeId,
    });
    if (request !== undefined) {
      setActiveSection("payment_requests");
      setConnectionDetail("Заявка создана из задачи");
    }
    return request;
  };

  const handleUploadTaskAttachments = async (task: WorkspaceTask, files: readonly File[]) => {
    try {
      await uploadFiles("task", task.id, files);
    } catch (error) {
      reportError(error);
    }
  };

  const handleUploadApprovalAttachments = async (
    request: ApprovalRequestSummary,
    files: readonly File[],
    documentRole: "general" | "primary" | "additional" = "additional",
  ) => {
    if (session === undefined) return;
    try {
      await uploadFiles("approval_request", request.id, files, documentRole);
      await refreshWorkspace(session.accessToken);
    } catch (error) {
      reportError(error);
    }
  };

  const handleReviseApproval = async (
    request: ApprovalRequestSummary,
    payload: PaymentRequestInput,
    primaryFiles: readonly File[],
    additionalFiles: readonly File[],
  ) => {
    if (session === undefined) return undefined;
    try {
      await uploadFiles("approval_request", request.id, primaryFiles, "primary");
      await uploadFiles("approval_request", request.id, additionalFiles, "additional");
      await updateWorkspaceApproval(session.accessToken, request.id, {
        ...payload,
        currency: request.currency,
        changeComment: "Исправлено после возврата",
      });
      const resubmitted = await actOnWorkspaceApproval(
        session.accessToken,
        request.id,
        "resubmit",
        { comment: "Исправленная версия отправлена повторно" },
      );
      setWorkspace((current) => ({
        ...current,
        requests: current.requests.map((item) =>
          item.id === resubmitted.id ? resubmitted : item,
        ),
      }));
      setConnectionDetail("Исправленная заявка отправлена повторно");
      return resubmitted;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleApprovalAction = async (
    requestId: string,
    action: "approve" | "reject" | "return" | "clarify" | "delegate" | "resubmit" | "cancel",
    options?: {
      readonly comment?: string;
      readonly nodeKey?: string;
      readonly delegateToUserId?: string;
    },
  ) => {
    if (session === undefined) return;
    try {
      const request = await actOnWorkspaceApproval(
        session.accessToken,
        requestId,
        action,
        options,
      );
      setWorkspace((current) => ({
        ...current,
        requests: current.requests.map((item) => (item.id === request.id ? request : item)),
      }));
    } catch (error) {
      reportError(error);
    }
  };

  const mergeProject = (project: WorkspaceProject) => {
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.some((item) => item.id === project.id)
        ? current.projects.map((item) => (item.id === project.id ? project : item))
        : [project, ...current.projects],
    }));
    return project;
  };

  const runProjectMutation = async (
    mutation: (token: string) => Promise<WorkspaceProject>,
  ): Promise<WorkspaceProject | undefined> => {
    if (session === undefined) return undefined;
    try {
      return mergeProject(await mutation(session.accessToken));
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateProject = (payload: ProjectInput) =>
    runProjectMutation((token) => createWorkspaceProject(token, payload));

  const handleUpdateProject = (project: WorkspaceProject, payload: ProjectInput) =>
    runProjectMutation((token) => updateWorkspaceProject(token, project.id, payload));

  const handleMoveProject = (
    project: WorkspaceProject,
    stage: ProjectStage,
    comment = "",
  ) => runProjectMutation((token) =>
    changeWorkspaceProjectStage(token, project.id, stage, comment));

  const mergeTripRequest = (tripRequest: TripRequest) => {
    setWorkspace((current) => ({
      ...current,
      tripRequests: current.tripRequests.some((item) => item.id === tripRequest.id)
        ? current.tripRequests.map((item) => item.id === tripRequest.id ? tripRequest : item)
        : [tripRequest, ...current.tripRequests],
    }));
    return tripRequest;
  };

  const runTripMutation = async (
    mutation: (token: string) => Promise<TripRequest>,
  ): Promise<TripRequest | undefined> => {
    if (session === undefined) return undefined;
    try {
      return mergeTripRequest(await mutation(session.accessToken));
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateTrip = (payload: TripRequestInput) =>
    runTripMutation((token) => createWorkspaceTripRequest(token, payload));

  const handleUpdateTrip = (tripRequest: TripRequest, payload: TripRequestInput) =>
    runTripMutation((token) => updateWorkspaceTripRequest(token, tripRequest.id, payload));

  const handleTripAction = (tripRequest: TripRequest, action: TripAction, comment = "") =>
    runTripMutation((token) =>
      actOnWorkspaceTripRequest(token, tripRequest.id, action, comment));

  const mergeFeedPost = (post: FeedPost) => {
    setWorkspace((current) => ({
      ...current,
      feedPosts: current.feedPosts.some((item) => item.id === post.id)
        ? current.feedPosts.map((item) => item.id === post.id ? post : item)
        : [post, ...current.feedPosts],
    }));
    return post;
  };

  const runFeedMutation = async (
    mutation: (token: string) => Promise<FeedPost>,
  ): Promise<FeedPost | undefined> => {
    if (session === undefined) return undefined;
    try {
      return mergeFeedPost(await mutation(session.accessToken));
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateFeedPost = (title: string, body: string) =>
    runFeedMutation((token) => createWorkspaceFeedPost(token, title, body));
  const handleFeedComment = (post: FeedPost, body: string) =>
    runFeedMutation((token) => addWorkspaceFeedComment(token, post.id, body));
  const handleFeedLike = (post: FeedPost, liked: boolean) =>
    runFeedMutation((token) => setWorkspaceFeedLike(token, post.id, liked));
  const handleFeedPin = (post: FeedPost, pinned: boolean) =>
    runFeedMutation((token) => pinWorkspaceFeedPost(token, post.id, pinned));

  const mergeCalendarEvent = (event: CalendarEvent) => {
    setWorkspace((current) => ({
      ...current,
      calendarEvents: current.calendarEvents.some((item) => item.id === event.id)
        ? current.calendarEvents.map((item) => item.id === event.id ? event : item)
        : [...current.calendarEvents, event],
    }));
    return event;
  };

  const runCalendarMutation = async (
    mutation: (token: string) => Promise<CalendarEvent>,
  ): Promise<CalendarEvent | undefined> => {
    if (session === undefined) return undefined;
    try {
      return mergeCalendarEvent(await mutation(session.accessToken));
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateCalendarEvent = (payload: CalendarEventInput) =>
    runCalendarMutation((token) => createWorkspaceCalendarEvent(token, payload));
  const handleUpdateCalendarEvent = (event: CalendarEvent, payload: CalendarEventInput) =>
    runCalendarMutation((token) => updateWorkspaceCalendarEvent(token, event.id, payload));
  const handleCancelCalendarEvent = (event: CalendarEvent) =>
    runCalendarMutation((token) => cancelWorkspaceCalendarEvent(token, event.id));

  const mergeNotification = (notification: WorkspaceNotification) => {
    setWorkspace((current) => ({
      ...current,
      notifications: current.notifications.map((item) =>
        item.id === notification.id ? notification : item,
      ),
    }));
  };

  const handleMarkNotificationRead = async (notification: WorkspaceNotification) => {
    if (session === undefined || notification.readAt) return;
    try {
      mergeNotification(
        await markWorkspaceNotificationRead(session.accessToken, notification.id),
      );
    } catch (error) {
      reportError(error);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (session === undefined) return;
    try {
      await markAllWorkspaceNotificationsRead(session.accessToken);
      const readAt = new Date().toISOString();
      setWorkspace((current) => ({
        ...current,
        notifications: current.notifications.map((item) => ({
          ...item,
          readAt: item.readAt ?? readAt,
        })),
      }));
    } catch (error) {
      reportError(error);
    }
  };

  const handleNotificationPreferences = async (preferences: NotificationPreferences) => {
    if (session === undefined) return;
    try {
      const saved = await updateWorkspaceNotificationPreferences(
        session.accessToken,
        preferences,
      );
      setWorkspace((current) => ({ ...current, notificationPreferences: saved }));
    } catch (error) {
      reportError(error);
    }
  };

  const openNotification = (notification: WorkspaceNotification) => {
    void handleMarkNotificationRead(notification);
    setFocusTarget((current) => ({
      section: notification.section,
      entityId: notification.entityId ?? undefined,
      revision: (current?.revision ?? 0) + 1,
    }));
    setActiveSection(notification.section);
  };

  useEffect(() => {
    return window.yuksalish?.onNotificationOpen((payload) => {
      const notification = workspace.notifications.find((item) => item.id === payload.id);
      if (session === undefined || notification === undefined) return;
      if (!notification.readAt) {
        void markWorkspaceNotificationRead(session.accessToken, notification.id)
          .then(mergeNotification)
          .catch(reportError);
      }
      setFocusTarget((current) => ({
        section: notification.section,
        entityId: notification.entityId ?? undefined,
        revision: (current?.revision ?? 0) + 1,
      }));
      setActiveSection(notification.section);
    });
  }, [session, workspace.notifications]);

  if (session === undefined) {
    return (
      <FluentProvider theme={webLightTheme} className="app-provider">
        <LoginView
          busy={authBusy}
          error={authError}
          onLogin={handleLogin}
          onAcceptInvitation={handleAcceptInvitation}
          onCompletePasswordReset={handleCompletePasswordReset}
        />
      </FluentProvider>
    );
  }

  const badgeBySection: Partial<Record<WorkspaceSection, number>> = {
    messenger: workspace.chats.reduce((total, chat) => total + chat.unread, 0),
    tasks: workspace.tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length,
    payment_requests: workspace.requests.filter((request) => request.status === "running").length,
  };
  const unreadNotifications = workspace.notifications.filter((item) => !item.readAt).length;

  return (
    <FluentProvider theme={webLightTheme} className="app-provider">
      <div className="app-shell">
        <aside className="app-rail" aria-label="Основная навигация">
          <div className="workspace-logo" aria-label="Yuksalish Workspace">
            <Navigation24Regular />
            <strong>Yuksalish</strong>
          </div>
          <nav className="rail-nav">
            {navItems.map((item) => {
              const badge = badgeBySection[item.key];
              const icon = activeSection === item.key && item.key === "messenger"
                ? <Chat24Filled />
                : activeSection === item.key && item.key === "tasks"
                  ? <TaskListSquareLtr24Filled />
                  : item.icon;
              return (
                <button
                  key={item.key}
                  className={`rail-action ${activeSection === item.key ? "active" : ""}`}
                  type="button"
                  aria-label={item.label}
                  aria-current={activeSection === item.key ? "page" : undefined}
                  onClick={() => {
                    setFocusTarget(undefined);
                    setActiveSection(item.key);
                  }}
                >
                  <span className="rail-icon">{icon}</span>
                  <span className="rail-label">{item.label}</span>
                  {badge ? <span className="rail-badge">{badge > 99 ? "99+" : badge}</span> : null}
                </button>
              );
            })}
          </nav>
          <div className="rail-bottom">
            <button
              className={`rail-action ${activeSection === "notifications" ? "active" : ""}`}
              type="button"
              aria-label="Уведомления"
              aria-current={activeSection === "notifications" ? "page" : undefined}
              onClick={() => setActiveSection("notifications")}
            >
              <span className="rail-icon"><Alert24Regular /></span>
              <span className="rail-label">Уведомления</span>
              {unreadNotifications ? (
                <span className="rail-badge">
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              ) : null}
            </button>
            <button
              className="rail-action"
              type="button"
              aria-label="Настройки"
              onClick={() => setAccountOpen(true)}
            >
              <span className="rail-icon"><Settings24Regular /></span>
              <span className="rail-label">Настройки</span>
            </button>
            <button className="rail-profile" type="button" onClick={() => setAccountOpen(true)}>
              <Avatar name={workspace.currentUser.name} size={32} color="colorful" />
              <span>{workspace.currentUser.name}</span>
            </button>
          </div>
        </aside>

        <div className="app-stage">
          <header className="global-bar">
            <div className="global-brand">
              <strong>Yuksalish Workspace</strong>
              <span className="connection-state online">{connectionDetail}</span>
            </div>
            <Input
              aria-label="Глобальный поиск"
              className="global-search"
              contentBefore={<Search24Regular />}
              placeholder="Найти сообщение, задачу или заявку"
            />
            <button className="account-trigger" type="button" onClick={() => setAccountOpen(true)}>
              <Avatar name={workspace.currentUser.name} size={28} color="colorful" />
              <span>
                <strong>{workspace.currentUser.name}</strong>
                <small>{workspace.currentUser.jobTitle ?? workspace.currentUser.role}</small>
              </span>
            </button>
            <Button appearance="subtle" onClick={() => void handleLogout()}>Выйти</Button>
          </header>

          <main className="app-content">
            {activeSection === "notifications" ? (
              <NotificationCenter
                notifications={workspace.notifications}
                preferences={workspace.notificationPreferences}
                onOpen={openNotification}
                onMarkRead={handleMarkNotificationRead}
                onMarkAllRead={handleMarkAllNotificationsRead}
                onUpdatePreferences={handleNotificationPreferences}
              />
            ) : null}
            {activeSection === "crm" ? (
              <ModulePreview
                icon={<Building24Regular />}
                title="CRM"
                evidence="В действующем Bitrix стандартные лиды, сделки, контакты и компании пусты. До реализации уточним, какие CRM‑сценарии действительно нужны Workspace."
                packageLabel="Пакет BP‑9 · CRM"
              />
            ) : null}
            {activeSection === "messenger" ? (
              <MessengerView
                key={focusTarget?.revision}
                chats={workspace.chats}
                messages={workspace.messages}
                attachments={workspace.attachments}
                people={workspace.people}
                onSendMessage={handleSendMessage}
                onCreateTaskFromMessage={handleCreateTaskFromMessage}
                onDownloadAttachment={handleDownloadAttachment}
                onMarkRead={handleMarkChatRead}
                focusChatId={focusTarget?.section === "messenger" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {activeSection === "tasks" ? (
              <TasksView
                key={focusTarget?.revision}
                tasks={workspace.tasks}
                attachments={workspace.attachments}
                people={workspace.people}
                currentUserId={workspace.currentUser.id}
                onCreateTask={handleCreateTask}
                onChangeStatus={handleTaskStatus}
                onUpdateTask={handleUpdateTask}
                onSetParticipant={handleSetTaskParticipant}
                onRemoveParticipant={handleRemoveTaskParticipant}
                onAddChecklistItem={handleAddChecklistItem}
                onToggleChecklistItem={handleToggleChecklistItem}
                onDeleteChecklistItem={handleDeleteChecklistItem}
                onAddComment={handleAddTaskComment}
                onSetDependency={handleSetTaskDependency}
                onRemoveDependency={handleRemoveTaskDependency}
                onSetCycle={handleSetTaskCycle}
                onCreateApprovalFromTask={handleCreateApprovalFromTask}
                onUploadAttachments={handleUploadTaskAttachments}
                onDownloadAttachment={handleDownloadAttachment}
                focusTaskId={focusTarget?.section === "tasks" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {activeSection === "payment_requests" ? (
              <ApprovalsView
                key={JSON.stringify([workspace.workflow, focusTarget?.revision])}
                canManage={["manager", "admin", "superadmin"].includes(workspace.currentUser.role)}
                canCreateRequest={workspace.canCreatePaymentRequests}
                currentUserId={workspace.currentUser.id}
                people={workspace.people}
                positions={workspace.positions}
                requests={workspace.requests}
                attachments={workspace.attachments}
                workflow={workspace.workflow}
                onSaveWorkflow={handleSaveWorkflow}
                onPublishWorkflow={handlePublishWorkflow}
                onCreateRequest={handleCreateApproval}
                onAction={handleApprovalAction}
                onReviseRequest={handleReviseApproval}
                onUploadAttachments={handleUploadApprovalAttachments}
                onDownloadAttachment={handleDownloadAttachment}
                focusRequestId={focusTarget?.section === "payment_requests" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {activeSection === "feed" ? (
              <FeedView
                posts={workspace.feedPosts}
                people={workspace.people}
                onCreate={handleCreateFeedPost}
                onComment={handleFeedComment}
                onLike={handleFeedLike}
                onPin={handleFeedPin}
              />
            ) : null}
            {activeSection === "projects" ? (
              <ProjectsView
                projects={workspace.projects}
                people={workspace.people}
                currentUser={workspace.currentUser}
                onCreate={handleCreateProject}
                onUpdate={handleUpdateProject}
                onMove={handleMoveProject}
              />
            ) : null}
            {activeSection === "trip_approvals" ? (
              <TripApprovalsView
                key={focusTarget?.revision}
                requests={workspace.tripRequests}
                people={workspace.people}
                currentUser={workspace.currentUser}
                onCreate={handleCreateTrip}
                onUpdate={handleUpdateTrip}
                onAction={handleTripAction}
                focusRequestId={focusTarget?.section === "trip_approvals" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {activeSection === "calendar" ? (
              <CalendarView
                key={focusTarget?.revision}
                events={workspace.calendarEvents}
                people={workspace.people}
                currentUserId={workspace.currentUser.id}
                onCreate={handleCreateCalendarEvent}
                onUpdate={handleUpdateCalendarEvent}
                onCancel={handleCancelCalendarEvent}
                focusEventId={focusTarget?.section === "calendar" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {activeSection === "employees" ? (
              <EmployeesView token={session.accessToken} currentUser={workspace.currentUser} />
            ) : null}
          </main>
        </div>
      </div>
      {accountOpen ? (
        <AccountPanel
          token={session.accessToken}
          user={workspace.currentUser}
          onClose={() => setAccountOpen(false)}
          onLogout={() => void handleLogout()}
        />
      ) : null}
    </FluentProvider>
  );
}
