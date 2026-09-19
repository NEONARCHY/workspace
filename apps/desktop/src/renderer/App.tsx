import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type {
  ApprovalRequestSummary,
  AbsenceAction,
  AbsenceRequest,
  AbsenceRequestInput,
  AuthenticationSession,
  CalendarEvent,
  CalendarEventInput,
  ChatSummary,
  ChatMessage,
  EfficiencyOverview,
  MessageOptions,
  EffectiveModuleAccess,
  MessageReactionEmoji,
  MembersRegistry,
  ZoomMeetingsRegistry,
  FeedPost,
  NotificationPreferences,
  NavigationKey,
  PersonalPreferences,
  ProjectInput,
  ProjectStage,
  TaskStatus,
  TaskEfficiencyExclusionReason,
  TaskReturnReason,
  TripAction,
  TripStage,
  TripRequest,
  TripRequestInput,
  PresenceSummaryItem,
  WorkflowDefinition,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceProject,
  WorkspaceNotification,
  WorkflowPosition,
  DesktopUpdatePolicy,
  WorkspaceSection,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
} from "@yuksalish/contracts";
import { moduleKeys } from "@yuksalish/contracts";
import {
  Button,
  FluentProvider,
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
  PersonAvailable24Regular,
  Settings24Regular,
  Edit16Regular,
  TaskListSquareLtr24Filled,
  TaskListSquareLtr24Regular,
  Video24Regular,
} from "@fluentui/react-icons";

import { AccountPanel } from "./AccountPanel";
import { DesktopUpdateGate } from "./DesktopUpdateGate";
import { requiresDesktopUpdate, type DesktopUpdateStatus } from "./desktop-updates";
import { workspacePlatform } from "./platform-adapter";
import { WebUpdateNotice } from "./WebUpdateNotice";
import { workspaceTheme } from "./workspace-theme";
import { SectionJump } from "./SectionJump";
import { ConnectionIndicator, WorkspaceIdentity } from "./WorkspaceIdentity";
import { ApprovalsView } from "./ApprovalsView";
import { CalendarView } from "./CalendarView";
import { CompanyLogo } from "./CompanyLogo";
import { ZoomView } from "./ZoomView";
import { NavigationEditor } from "./NavigationEditor";
import { defaultPersonalPreferences, latestPreferences, normalizeNavigation } from "./personal-organization";
import type { ChatActions } from "./ChatManagement";
import { EmployeesView } from "./EmployeesView";
import { FeedView } from "./FeedView";
import { LoginView } from "./LoginView";
import { EmbeddedConversation, MessengerView } from "./MessengerView";
import { NotificationCenter } from "./NotificationCenter";
import { ProjectsView } from "./ProjectsView";
import { TasksView } from "./TasksView";
import { TripApprovalsView } from "./TripApprovalsView";
import { AbsencesView } from "./AbsencesView";
import { AdaptiveNavigation } from "./AdaptiveNavigation";
import { MembersView } from "./MembersView";
import { RecoveryBoundary } from "./RecoveryBoundary";
import { ProfileAvatar } from "./ProfileAvatar";
import { createRefreshQueue } from "./refresh-queue";
import { useCompactWindow } from "./use-compact-window";
import {
  acceptInvitation,
  acceptWorkspaceTaskResult,
  changePersonalChat,
  reorderPinnedChats,
  reorderNavigation,
  actOnWorkspaceTripRequest,
  actOnWorkspaceAbsence,
  actOnWorkspaceApproval,
  addWorkspaceTaskChecklistItem,
  addWorkspaceTaskComment,
  changeWorkspaceTaskStatus,
  changeWorkspaceProjectStage,
  cancelWorkspaceCalendarEvent,
  completePasswordReset,
  createWorkspaceApproval,
  deleteWorkspaceApproval,
  createWorkspaceCalendarEvent,
  createWorkspaceFeedPost,
  deleteWorkspaceFeedPost,
  deleteWorkspaceTask,
  createWorkspaceProject,
  createWorkspaceTask,
  createWorkspaceTripRequest,
  createWorkspaceAbsence,
  deleteWorkspaceTaskChecklistItem,
  downloadWorkspaceAttachment,
  loadWorkspace,
  loadWorkspaceEfficiency,
  loadMembersRegistry,
  loadZoomMeetings,
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
  returnWorkspaceTaskForRevision,
  publishWorkspaceWorkflow,
  saveWorkspaceWorkflow,
  sendWorkspaceMessage,
  createWorkspaceChat,
  updateWorkspaceChat,
  deleteWorkspaceChat,
  addWorkspaceChatMembers,
  setWorkspaceChatMember,
  removeWorkspaceChatMember,
  transferWorkspaceChatOwner,
  editWorkspaceMessage,
  deleteWorkspaceMessage,
  setWorkspaceMessagePinned,
  toggleWorkspaceMessageReaction,
  setWorkspaceFeedReaction,
  setWorkspaceTaskCommentReaction,
  setWorkspaceTaskCycle,
  setWorkspaceTaskDependency,
  setWorkspaceTaskParticipant,
  setWorkspaceTaskEfficiencyExclusion,
  subscribeToWorkspaceEvents,
  submitWorkspaceTaskResult,
  updateWorkspaceApproval,
  updateWorkspaceCalendarEvent,
  updateWorkspaceProject,
  updateWorkspaceTask,
  updateWorkspaceTripRequest,
  updateWorkspaceNotificationPreferences,
  toggleWorkspaceTaskChecklistItem,
  uploadWorkspaceAttachment,
  addWorkspaceFeedComment,
  deleteWorkspaceFeedComment,
  type PaymentRequestInput,
  apiBaseUrl,
  loadDesktopUpdatePolicy,
} from "./workspace-api";

interface NavItem {
  readonly key: NavigationKey;
  readonly label: string;
  readonly icon: ReactNode;
}

interface WorkspaceState {
  readonly personalPreferences: PersonalPreferences;
  readonly currentUser: WorkspacePerson;
  readonly moduleAccess: readonly EffectiveModuleAccess[];
  readonly canCreatePaymentRequests: boolean;
  readonly people: readonly WorkspacePerson[];
  readonly positions: readonly WorkflowPosition[];
  readonly chats: readonly ChatSummary[];
  readonly messages: readonly ChatMessage[];
  readonly tasks: readonly WorkspaceTask[];
  readonly requests: readonly ApprovalRequestSummary[];
  readonly requestWorkflows?: readonly WorkflowDefinition[];
  readonly projects: readonly WorkspaceProject[];
  readonly tripRequests: readonly TripRequest[];
  readonly absenceRequests: readonly AbsenceRequest[];
  readonly presenceSummary: readonly PresenceSummaryItem[];
  readonly feedPosts: readonly FeedPost[];
  readonly calendarEvents: readonly CalendarEvent[];
  readonly notifications: readonly WorkspaceNotification[];
  readonly notificationPreferences: NotificationPreferences;
  readonly attachments: readonly WorkspaceAttachment[];
  readonly workflow?: WorkflowDefinition | null;
}

const defaultModuleAccess: readonly EffectiveModuleAccess[] = moduleKeys.map((moduleKey) => ({
  moduleKey,
  permissions: { view: true, create: true, edit: true, approve: true, admin: true },
}));

const initialWorkspace: WorkspaceState = {
  personalPreferences: defaultPersonalPreferences,
  currentUser: {
    id: "signed-out",
    username: "signed-out",
    name: "",
    initials: "",
    role: "employee",
    color: "brand",
  },
  moduleAccess: defaultModuleAccess,
  canCreatePaymentRequests: false,
  people: [],
  positions: [],
  chats: [],
  messages: [],
  tasks: [],
  requests: [],
  requestWorkflows: [],
  projects: [],
  tripRequests: [],
  absenceRequests: [],
  presenceSummary: [],
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
    absencesEnabled: true,
    zoomEnabled: true,
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
  { key: "zoom_meetings", label: "Zoom-конференции", icon: <Video24Regular /> },
  { key: "absences", label: "Отсутствия", icon: <PersonAvailable24Regular /> },
  { key: "members", label: "Работа с членами", icon: <PeopleTeam24Regular /> },
  { key: "employees", label: "Сотрудники", icon: <PeopleTeam24Regular /> },
  { key: "notifications", label: "Уведомления", icon: <Alert24Regular /> },
  { key: "settings", label: "Настройки", icon: <Settings24Regular /> },
];

const navigationLabels = Object.fromEntries(navItems.map((item) => [item.key, item.label])) as Record<NavigationKey, string>;

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
          <span>Назначение CRM определим отдельно, когда она понадобится команде.</span>
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
  const [sessionRestoring, setSessionRestoring] = useState(() => workspacePlatform.hasSessionHint());
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace);
  const [efficiency, setEfficiency] = useState<EfficiencyOverview>();
  const [efficiencyLoading, setEfficiencyLoading] = useState(false);
  const [efficiencyError, setEfficiencyError] = useState<string>();
  const [membersRegistry, setMembersRegistry] = useState<MembersRegistry>();
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string>();
  const [zoomRegistry, setZoomRegistry] = useState<ZoomMeetingsRegistry>();
  const [zoomLoading, setZoomLoading] = useState(false);
  const [zoomError, setZoomError] = useState<string>();
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountInvite, setAccountInvite] = useState(false);
  const closeAccount = () => { setAccountOpen(false); setAccountInvite(false); };
  const [navigationEditing, setNavigationEditing] = useState(false);
  const compactWindow = useCompactWindow();
  const [railPreference, setRailPreference] = useState<boolean>();
  const railCollapsed = railPreference ?? compactWindow;
  const [backgroundError, setBackgroundError] = useState("");
  const [updatePolicy, setUpdatePolicy] = useState<DesktopUpdatePolicy>();
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus>({ phase: "idle" });
  const activeToken = useRef<string | undefined>(undefined);
  const [focusTarget, setFocusTarget] = useState<{
    section: WorkspaceSection; entityId?: string; revision: number;
  }>();
  const knownNotificationIds = useRef<Set<string> | null>(null);

  // Factory stores the reader; it is invoked only after an asynchronous response.
  // eslint-disable-next-line react-hooks/refs
  const [refreshWorkspace] = useState(() => createRefreshQueue(loadWorkspace, (loaded) => {
    setWorkspace((current) => ({ ...loaded, moduleAccess: loaded.moduleAccess ?? defaultModuleAccess, personalPreferences: current.currentUser.id === loaded.currentUser.id
      ? latestPreferences(current.personalPreferences, loaded.personalPreferences ?? defaultPersonalPreferences)
      : loaded.personalPreferences ?? defaultPersonalPreferences }));
    setBackgroundError("");
    setConnectionDetail("Сервер подключён");
  }, () => activeToken.current));

  const persistRefreshSession = useCallback((refreshToken?: string) => {
    if (refreshToken) void workspacePlatform.saveRefreshSession(refreshToken).catch(() => undefined);
  }, []);

  const establishSession = useCallback(async (authenticated: AuthenticationSession) => {
    const loaded = await loadWorkspace(authenticated.accessToken);
    setUpdatePolicy(undefined);
    activeToken.current = authenticated.accessToken;
    knownNotificationIds.current = new Set(loaded.notifications.map((item) => item.id));
    setFocusTarget(undefined);
    setWorkspace({ ...loaded, moduleAccess: loaded.moduleAccess ?? defaultModuleAccess, personalPreferences: loaded.personalPreferences ?? defaultPersonalPreferences });
    setEfficiency(undefined);
    setEfficiencyError(undefined);
    setMembersRegistry(undefined);
    setMembersError(undefined);
    setNavigationEditing(false);
    setSession(authenticated);
    persistRefreshSession(authenticated.refreshToken);
    try {
      const web = workspacePlatform.kind === "web";
      const key = web
        ? "yuksalish:web:last-section"
        : `yuksalish:resume-section:${authenticated.user.id}`;
      const storage = web ? sessionStorage : localStorage;
      const lastSection = storage.getItem(key);
      if (!web) storage.removeItem(key);
      if (lastSection && navItems.some((item) => item.key === lastSection && item.key !== "settings")) {
        setActiveSection(lastSection as WorkspaceSection);
      }
    } catch { /* local storage can be disabled */ }
    setConnectionDetail("Сервер подключён");
    setAuthError(undefined);
    setBackgroundError("");
  }, [persistRefreshSession]);

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
    activeToken.current = undefined;
    setAccountOpen(false);
    setAccountInvite(false);
    setNavigationEditing(false);
    setSession(undefined);
    setUpdatePolicy(undefined);
    setMembersRegistry(undefined);
    setMembersError(undefined);
    setAuthError(undefined);
    knownNotificationIds.current = null;
    if (current !== undefined) {
      await logout(current.accessToken).catch(() => undefined);
    }
    await workspacePlatform.clearRefreshSession().catch(() => undefined);
  };

  const reportError = useCallback((error: unknown) => {
    setConnectionDetail("Не удалось выполнить операцию");
    setBackgroundError(error instanceof Error ? error.message : "Ошибка операции");
  }, []);

  const refreshMembers = useCallback(async () => {
    if (!session || membersLoading) return;
    setMembersLoading(true);
    setMembersError(undefined);
    try {
      setMembersRegistry(await loadMembersRegistry(session.accessToken));
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : "Не удалось загрузить реестр членов.");
    } finally {
      setMembersLoading(false);
    }
  }, [membersLoading, session]);

  const refreshZoom = useCallback(async () => {
    if (!session) return;
    setZoomLoading(true);
    try {
      setZoomRegistry(await loadZoomMeetings(session.accessToken));
      setZoomError(undefined);
    } catch (error) {
      setZoomError(error instanceof Error ? error.message : "Не удалось загрузить конференции.");
    } finally {
      setZoomLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!workspacePlatform.onDesktopUpdateStatus) return;
    return workspacePlatform.onDesktopUpdateStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    // The calendar shows conferences too, so both sections need the schedule.
    if (activeSection !== "zoom_meetings" && activeSection !== "calendar") return undefined;
    const timer = window.setTimeout(() => void refreshZoom(), 0);
    return () => window.clearTimeout(timer);
  }, [activeSection, refreshZoom]);

  useEffect(() => {
    if (activeSection !== "members" || membersRegistry || membersError) return undefined;
    // Defer the request outside the effect turn; navigation state remains responsive.
    const timer = window.setTimeout(() => void refreshMembers(), 0);
    return () => window.clearTimeout(timer);
  }, [activeSection, membersError, membersRegistry, refreshMembers]);

  useEffect(() => {
    if (!workspacePlatform.hasSessionHint()) {
      return;
    }
    let active = true;
    void workspacePlatform.loadRefreshSession()
      .then(async (refreshToken) => {
        if (!refreshToken) return;
        let renewedSession = false;
        try {
          const renewed = await refreshAuthentication(
            workspacePlatform.kind === "web" ? undefined : refreshToken,
          );
          renewedSession = true;
          if (!active) return;
          // A refresh token can rotate. Persist its replacement before the
          // workspace bootstrap request so a transient connection error does
          // not leave the employee signed out on the next opening.
          if (renewed.refreshToken) {
            await workspacePlatform.saveRefreshSession(renewed.refreshToken).catch(() => undefined);
          }
          if (active) await establishSession(renewed);
        } catch {
          if (!active) return;
          if (!renewedSession) {
            await workspacePlatform.clearRefreshSession().catch(() => undefined);
            return;
          }
          setAuthError("Не удалось загрузить рабочее пространство. Повторите открытие приложения.");
        }
      })
      .finally(() => { if (active) setSessionRestoring(false); });
    return () => { active = false; };
  }, [establishSession]);

  useEffect(() => {
    if (!session || workspacePlatform.kind !== "electron") return;
    let active = true;
    const refreshPolicy = () => {
      void loadDesktopUpdatePolicy(session.accessToken)
        .then((policy) => { if (active) setUpdatePolicy(policy); })
        .catch(() => { /* retain the last known gate during a transient disconnection */ });
    };
    refreshPolicy();
    const timer = window.setInterval(refreshPolicy, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session]);

  useEffect(() => {
    if (!session || !updatePolicy?.publishedVersion || !workspacePlatform.configureUpdates) return;
    let active = true;
    void workspacePlatform.configureUpdates(apiBaseUrl, session.accessToken)
      .then((status) => {
        if (!active) return;
        setUpdateStatus(status);
        return workspacePlatform.checkForDesktopUpdates?.().then((checked) => {
          if (active) setUpdateStatus(checked);
        });
      })
      .catch((error: unknown) => {
        if (active) setUpdateStatus({ phase: "error", message: error instanceof Error ? error.message : "Не удалось настроить обновление" });
      });
    return () => { active = false; };
  }, [session, updatePolicy?.publishedVersion]);

  useEffect(() => {
    if (session === undefined) return;
    let cancelled = false;
    const refreshAfter = Math.max(60_000, (session.expiresIn - 60) * 1_000);
    const timer = window.setTimeout(() => {
      void refreshAuthentication(session.refreshToken)
        .then(async (renewed) => {
          if (cancelled) return;
          activeToken.current = renewed.accessToken;
          setSession(renewed);
          persistRefreshSession(renewed.refreshToken);
          await refreshWorkspace(renewed.accessToken).catch(reportError);
        })
        .catch(() => {
          if (cancelled) return;
          activeToken.current = undefined;
          setSession(undefined);
          setUpdatePolicy(undefined);
          void workspacePlatform.clearRefreshSession().catch(() => undefined);
          setAuthError("Сессия завершена. Войдите снова.");
        });
    }, refreshAfter);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [persistRefreshSession, refreshWorkspace, reportError, session]);

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
      absence: preferences.absencesEnabled,
      zoom: preferences.zoomEnabled,
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
      void workspacePlatform.showNotification({
        id: notification.id,
        title: "Yuksalish Workspace",
        body: `${notification.title}\n${notification.body}`,
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
        }).catch(() => {
          // The notification can be resolved by the same workflow update while
          // the native toast is being shown. Delivery acknowledgement is
          // best-effort and must not surface a stale 404 as a workspace error.
        });
      }).catch(reportError);
    }
  }, [reportError, session, workspace.notificationPreferences, workspace.notifications]);

  useEffect(() => {
    if (session === undefined) return;
    return subscribeToWorkspaceEvents(session.accessToken, () => {
      void refreshWorkspace(session.accessToken).catch(reportError);
      if (workspacePlatform.kind === "electron") {
        void loadDesktopUpdatePolicy(session.accessToken).then(setUpdatePolicy).catch(() => undefined);
      }
    }, reportError);
  }, [refreshWorkspace, reportError, session]);

  useEffect(() => {
    if (!session || workspacePlatform.kind !== "web") return;
    try { sessionStorage.setItem("yuksalish:web:last-section", activeSection); }
    catch { /* session storage can be disabled */ }
  }, [activeSection, session]);

  const personalMutation = async (operation: (token: string) => Promise<PersonalPreferences>) => {
    if (!session) throw new Error("Войдите снова");
    try {
      const saved = await operation(session.accessToken);
      if (!activeToken.current) return;
      setWorkspace((current) => current.currentUser.id === session.user.id
        ? { ...current, personalPreferences: latestPreferences(current.personalPreferences, saved) } : current);
    } catch (error) {
      void refreshWorkspace(session.accessToken).catch(reportError);
      throw error;
    }
  };

  const uploadFiles = async (
    ownerType: "message" | "task" | "approval_request" | "absence",
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

  const handleLoadAttachment = async (attachment: WorkspaceAttachment) => {
    if (session === undefined) throw new Error("Войдите снова");
    return await downloadWorkspaceAttachment(session.accessToken, attachment.id);
  };

  const storeMessage = (message: ChatMessage) => {
    setWorkspace((current) => ({
      ...current,
      messages: current.messages.some((item) => item.id === message.id)
        ? current.messages.map((item) => item.id === message.id ? message : item)
        : [...current.messages, message],
    }));
  };

  const handleSendMessage = async (chatId: string, body: string, files: readonly File[], options: MessageOptions) => {
    if (session === undefined) return undefined;
    let message: ChatMessage | undefined;
    try {
      message = await sendWorkspaceMessage(session.accessToken, chatId, body, options);
      await uploadFiles("message", message.id, files);
      storeMessage(message);
      return message;
    } catch (error) {
      if (message && files.length > 0) {
        try {
          await deleteWorkspaceMessage(session.accessToken, message);
        } catch {
          // The refresh reconciles an uncertain cleanup without losing the draft/files.
        }
        void refreshWorkspace(session.accessToken).catch(reportError);
      }
      reportError(error);
      throw error;
    }
  };

  const handleSendVoiceMessage = async (
    chatId: string,
    file: File,
    durationMs: number,
    options: MessageOptions,
  ) => {
    if (session === undefined) return undefined;
    let message: ChatMessage | undefined;
    try {
      message = await sendWorkspaceMessage(session.accessToken, chatId, "Голосовое сообщение", options);
      const attachment = await uploadWorkspaceAttachment(
        session.accessToken,
        "message",
        message.id,
        file,
        "general",
        { mediaKind: "voice", mediaDurationMs: durationMs, mediaCodec: "opus" },
      );
      storeMessage(message);
      setWorkspace((current) => ({ ...current, attachments: [...current.attachments, attachment] }));
      return message;
    } catch (error) {
      if (message) {
        try {
          await deleteWorkspaceMessage(session.accessToken, message);
        } catch {
          // A failed cleanup is reconciled by the refresh below.
        }
        void refreshWorkspace(session.accessToken).catch(reportError);
      }
      reportError(error);
      throw error;
    }
  };

  const handleMessageReaction = async (message: ChatMessage, emoji: MessageReactionEmoji) => {
    if (!session) throw new Error("Войдите снова");
    storeMessage(await toggleWorkspaceMessageReaction(session.accessToken, message.id, emoji));
  };

  const handleMessagePin = async (message: ChatMessage, pinned: boolean) => {
    if (!session) throw new Error("Войдите снова");
    storeMessage(await setWorkspaceMessagePinned(session.accessToken, message.id, pinned));
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

  const messengerMutation = async <T,>(operation: (token: string) => Promise<T>): Promise<T> => {
    if (!session) throw new Error("Войдите в Workspace");
    const result = await operation(session.accessToken);
    try {
      await refreshWorkspace(session.accessToken);
    } catch {
      reportError(new Error("Изменения сохранены. Не удалось обновить экран — проверьте подключение."));
    }
    return result;
  };
  const chatActions: ChatActions = {
    create: async (input) => {
      const chat = await messengerMutation((token) => createWorkspaceChat(token, input));
      setWorkspace((current) => ({ ...current, chats: [chat, ...current.chats.filter((item) => item.id !== chat.id)] }));
      return chat;
    },
    update: (id, title, description) => messengerMutation((token) => updateWorkspaceChat(token, id, title, description)),
    add: (id, ids) => messengerMutation((token) => addWorkspaceChatMembers(token, id, ids)),
    setMember: (id, member) => messengerMutation((token) => setWorkspaceChatMember(token, id, member)),
    remove: (id, userId) => messengerMutation((token) => removeWorkspaceChatMember(token, id, userId)),
    transfer: (id, userId) => messengerMutation((token) => transferWorkspaceChatOwner(token, id, userId)),
    delete: (id) => messengerMutation((token) => deleteWorkspaceChat(token, id)),
  };

  const handleCreateTask = async (payload: WorkspaceTaskCreateInput) => {
    if (session === undefined) return undefined;
    try {
      const task = await createWorkspaceTask(session.accessToken, payload);
      setWorkspace((current) => ({ ...current, tasks: [task, ...current.tasks] }));
      return task;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateTaskFromMessage = async (
    message: ChatMessage,
    payload: WorkspaceTaskCreateInput,
  ) => {
    if (session === undefined) return undefined;
    try {
      const task = await createWorkspaceTask(session.accessToken, {
        ...payload,
        sourceMessageId: message.id,
      });
      setWorkspace((current) => ({ ...current, tasks: [task, ...current.tasks] }));
      setActiveSection("tasks");
      setFocusTarget(current => ({ section: "tasks", entityId: task.id, revision: (current?.revision ?? 0) + 1 }));
      setConnectionDetail("Задача создана из сообщения");
      return task;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateSubtask = async (
    parent: WorkspaceTask,
    payload: { readonly title: string; readonly assigneeId: string; readonly dueAt?: string },
  ) => {
    if (session === undefined) return undefined;
    try {
      const task = await createWorkspaceTask(session.accessToken, {
        ...payload,
        parentTaskId: parent.id,
        project: parent.project,
      });
      setWorkspace((current) => ({ ...current, tasks: [task, ...current.tasks] }));
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
      if (efficiency !== undefined) void loadWorkspaceEfficiency(session.accessToken, efficiency.period).then(setEfficiency).catch(() => undefined);
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
      const task = mergeTask(await mutation(session.accessToken));
      if (efficiency !== undefined) void loadWorkspaceEfficiency(session.accessToken, efficiency.period).then(setEfficiency).catch(() => undefined);
      return task;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleLoadEfficiency = useCallback(async (period?: string) => {
    if (session === undefined) return;
    setEfficiencyLoading(true);
    setEfficiencyError(undefined);
    try {
      setEfficiency(await loadWorkspaceEfficiency(session.accessToken, period));
    } catch (error) {
      setEfficiencyError(error instanceof Error ? error.message : "Не удалось загрузить данные");
    } finally {
      setEfficiencyLoading(false);
    }
  }, [session]);

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

  const handleDeleteTask = async (task: WorkspaceTask): Promise<boolean> => {
    if (session === undefined) return false;
    try {
      await deleteWorkspaceTask(session.accessToken, task.id);
      setWorkspace((current) => ({
        ...current,
        tasks: (() => {
          const deletedIds = new Set([task.id]);
          let foundDescendant = true;
          while (foundDescendant) {
            foundDescendant = false;
            for (const item of current.tasks) {
              if (item.parentTaskId && deletedIds.has(item.parentTaskId) && !deletedIds.has(item.id)) {
                deletedIds.add(item.id);
                foundDescendant = true;
              }
            }
          }
          return current.tasks.filter((item) => !deletedIds.has(item.id));
        })(),
      }));
      if (efficiency !== undefined) {
        void loadWorkspaceEfficiency(session.accessToken, efficiency.period)
          .then(setEfficiency)
          .catch(() => undefined);
      }
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

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

  const handleTaskCommentReaction = (
    task: WorkspaceTask,
    commentId: string,
    emoji: string,
    reacted: boolean,
  ) => runTaskMutation((token) =>
    setWorkspaceTaskCommentReaction(token, task.id, commentId, emoji, reacted));

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
      readonly scheduleKind: "daily" | "weekly" | "monthly" | "calendar";
      readonly interval: number;
      readonly calendarRule?: "weekdays" | "month_days" | null;
      readonly weekdays?: readonly number[];
      readonly monthDays?: readonly number[];
      readonly nextRunAt?: string | null;
      readonly isEnabled: boolean;
    },
  ) => runTaskMutation((token) => setWorkspaceTaskCycle(token, task.id, payload));

  const handleOpenContextChat = async (chatId: string) => {
    if (!session) return;
    if (!workspace.chats.some((chat) => chat.id === chatId)) {
      try {
        await refreshWorkspace(session.accessToken);
      } catch (error) {
        reportError(error);
        return;
      }
    }
    setActiveSection("messenger");
    setFocusTarget((current) => ({
      section: "messenger",
      entityId: chatId,
      revision: (current?.revision ?? 0) + 1,
    }));
  };

  const handleReturnTaskForRevision = (
    task: WorkspaceTask,
    reasonCode: TaskReturnReason,
    reasonText: string,
  ) => runTaskMutation((token) => returnWorkspaceTaskForRevision(
    token, task.id, reasonCode, reasonText,
  ));

  const handleSubmitTaskResult = (task: WorkspaceTask, resultText: string) =>
    runTaskMutation((token) => submitWorkspaceTaskResult(token, task.id, resultText));

  const handleAcceptTaskResult = (task: WorkspaceTask) =>
    runTaskMutation((token) => acceptWorkspaceTaskResult(token, task.id));

  const handleTaskEfficiencyExclusion = (
    task: WorkspaceTask,
    excluded: boolean,
    reasonCode?: TaskEfficiencyExclusionReason,
    reasonText = "",
  ) => runTaskMutation((token) => setWorkspaceTaskEfficiencyExclusion(
    token, task.id, excluded, reasonCode, reasonText,
  ));

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
    action: "approve" | "reject" | "return" | "clarify" | "delegate" | "resubmit" | "cancel" | "move",
    options?: {
      readonly comment?: string;
      readonly nodeKey?: string;
      readonly delegateToUserId?: string;
    },
  ) => {
    if (session === undefined) throw new Error("Сеанс завершён. Войдите повторно.");
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
      throw error;
    }
  };

  const handleDeleteApproval = async (request: ApprovalRequestSummary) => {
    if (session === undefined) throw new Error("Сеанс завершён. Войдите повторно.");
    try {
      await deleteWorkspaceApproval(session.accessToken, request.id);
      setWorkspace((current) => ({
        ...current,
        requests: current.requests.filter((item) => item.id !== request.id),
        attachments: current.attachments.filter(
          (attachment) => attachment.ownerType !== "approval_request" || attachment.ownerId !== request.id,
        ),
      }));
    } catch (error) {
      reportError(error);
      throw error;
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

  const handleTripAction = (
    tripRequest: TripRequest,
    action: TripAction,
    comment = "",
    targetStage?: TripStage,
  ) =>
    runTripMutation((token) =>
      actOnWorkspaceTripRequest(token, tripRequest.id, action, comment, targetStage));

  const mergeAbsenceRequest = (absenceRequest: AbsenceRequest) => {
    setWorkspace((current) => ({
      ...current,
      absenceRequests: current.absenceRequests.some((item) => item.id === absenceRequest.id)
        ? current.absenceRequests.map((item) => item.id === absenceRequest.id ? absenceRequest : item)
        : [absenceRequest, ...current.absenceRequests],
    }));
    return absenceRequest;
  };

  const runAbsenceMutation = async (
    mutation: (token: string) => Promise<AbsenceRequest>,
  ): Promise<AbsenceRequest | undefined> => {
    if (session === undefined) return undefined;
    try {
      return mergeAbsenceRequest(await mutation(session.accessToken));
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleCreateAbsence = (payload: AbsenceRequestInput) =>
    runAbsenceMutation((token) => createWorkspaceAbsence(token, payload));

  const handleAbsenceAction = (absenceRequest: AbsenceRequest, action: AbsenceAction, comment = "") =>
    runAbsenceMutation((token) => actOnWorkspaceAbsence(token, absenceRequest.id, action, comment));

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
  const handleFeedComment = (post: FeedPost, body: string, parentCommentId?: string) =>
    runFeedMutation((token) => addWorkspaceFeedComment(token, post.id, body, parentCommentId));
  const handleFeedReaction = (post: FeedPost, emoji: string, reacted: boolean, commentId?: string) =>
    runFeedMutation((token) => setWorkspaceFeedReaction(token, post.id, emoji, reacted, commentId));
  const handleFeedCommentDelete = (post: FeedPost, commentId: string) =>
    runFeedMutation((token) => deleteWorkspaceFeedComment(token, post.id, commentId));
  const handleFeedPin = (post: FeedPost, pinned: boolean) =>
    runFeedMutation((token) => pinWorkspaceFeedPost(token, post.id, pinned));

  const handleFeedDelete = async (post: FeedPost): Promise<boolean> => {
    if (session === undefined) return false;
    try {
      await deleteWorkspaceFeedPost(session.accessToken, post.id);
      setWorkspace((current) => ({
        ...current,
        feedPosts: current.feedPosts.filter((item) => item.id !== post.id),
      }));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

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
      if (
        workspacePlatform.kind === "web"
        && preferences.desktopEnabled
        && !workspace.notificationPreferences.desktopEnabled
      ) {
        const allowed = await workspacePlatform.requestNotificationPermission();
        if (!allowed) throw new Error("Браузер не разрешил системные уведомления.");
      }
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
    return workspacePlatform.onNotificationOpen((payload) => {
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
  }, [reportError, session, workspace.notifications]);

  if (session === undefined) {
    return (
      <FluentProvider theme={workspaceTheme} className="app-provider">
        <LoginView
          busy={authBusy || sessionRestoring}
          error={authError}
          restoring={sessionRestoring}
          onLogin={handleLogin}
          onAcceptInvitation={handleAcceptInvitation}
          onCompletePasswordReset={handleCompletePasswordReset}
        />
      </FluentProvider>
    );
  }

  if (workspacePlatform.kind === "electron" && requiresDesktopUpdate(updatePolicy, workspacePlatform.version)) {
    return <FluentProvider theme={workspaceTheme} className="app-provider">
      <DesktopUpdateGate
        requiredVersion={updatePolicy!.minimumVersion!}
        currentVersion={workspacePlatform.version}
        status={updateStatus}
        title={updatePolicy?.release?.title}
        notes={updatePolicy?.release?.notes}
        onRetry={() => void workspacePlatform.checkForDesktopUpdates?.().then(setUpdateStatus).catch((error: unknown) => {
          setUpdateStatus({ phase: "error", message: error instanceof Error ? error.message : "Не удалось проверить обновление" });
        })}
        onInstall={() => {
          try { localStorage.setItem(`yuksalish:resume-section:${session.user.id}`, activeSection); }
          catch { /* local storage can be disabled */ }
          void workspacePlatform.installDesktopUpdate?.().catch((error: unknown) => {
            setUpdateStatus({ phase: "error", message: error instanceof Error ? error.message : "Не удалось установить обновление" });
          });
        }}
      />
    </FluentProvider>;
  }

  const modulePermissions = Object.fromEntries(workspace.moduleAccess.map((item) => [item.moduleKey, item.permissions]));
  const canView = (key: NavigationKey) => key === "notifications" || key === "settings" || modulePermissions[key]?.view !== false;
  const badgeBySection: Partial<Record<NavigationKey, number>> = {
    messenger: workspace.chats.reduce((total, chat) => total + chat.unread, 0),
    tasks: workspace.tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length,
    payment_requests: workspace.requests.filter((request) => request.status === "running").length,
    notifications: workspace.notifications.filter((item) => !item.readAt).length,
  };
  const orderedNavItems = normalizeNavigation(workspace.personalPreferences.navigationOrder)
    .filter(canView)
    .map((key) => navItems.find((item) => item.key === key)!);
  const activeSectionDenied = activeSection !== "notifications" && modulePermissions[activeSection]?.view === false;
  const fallbackSection = orderedNavItems.find((item) => item.key !== "settings")?.key ?? "notifications";
  const displayedSection = activeSectionDenied && fallbackSection !== "settings" ? fallbackSection : activeSection;

  return (
    <FluentProvider theme={workspaceTheme} className="app-provider">
      <a className="skip-to-content" href="#workspace-content">Перейти к содержимому</a>
      <div className={`app-shell ${railCollapsed ? "rail-collapsed" : ""}`}>
        <aside className="app-rail" aria-label="Основная навигация">
          <div className="workspace-logo" aria-label="Yuksalish Workspace">
            <button type="button" className="rail-toggle" disabled={navigationEditing} aria-label={railCollapsed ? "Развернуть меню" : "Свернуть меню"} aria-expanded={!railCollapsed} onClick={() => setRailPreference(!railCollapsed)}><Navigation24Regular /></button>
            <CompanyLogo tone="color" className="rail-brand" />
          </div>
          <div className="rail-customize">
            <span>Меню</span>
            <button type="button" aria-label="Изменить порядок меню" title="Изменить порядок меню" aria-expanded={navigationEditing}
              disabled={navigationEditing} onClick={() => { setRailPreference(false); setNavigationEditing(true); }}><Edit16Regular /></button>
          </div>
          {navigationEditing ? <NavigationEditor key={workspace.currentUser.id}
            order={workspace.personalPreferences.navigationOrder} revision={workspace.personalPreferences.revision} labels={navigationLabels}
            icons={Object.fromEntries(navItems.map((item) => [item.key, item.icon]))}
            badges={badgeBySection}
            onClose={() => setNavigationEditing(false)}
            onSave={(order, revision) => personalMutation((token) => reorderNavigation(token, order, revision))}
          /> : <AdaptiveNavigation items={orderedNavItems} renderItem={(item) => {
              const badge = badgeBySection[item.key];
              const icon = displayedSection === item.key && item.key === "messenger"
                ? <Chat24Filled />
                : displayedSection === item.key && item.key === "tasks"
                  ? <TaskListSquareLtr24Filled />
                  : item.icon;
              return (
                <div key={item.key} className="rail-slot" data-navigation-key={item.key}><button
                  className={`rail-action ${displayedSection === item.key ? "active" : ""}`}
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                  aria-current={displayedSection === item.key ? "page" : undefined}
                  onClick={() => {
                    if (item.key === "settings") { setAccountOpen(true); return; }
                    setFocusTarget(undefined);
                    setActiveSection(item.key);
                  }}
                >
                  <span className="rail-icon">{icon}</span>
                  <span className="rail-label">{item.label}</span>
                  {badge ? <span className="rail-badge">{badge > 99 ? "99+" : badge}</span> : null}
                </button></div>
              );
            }} />}
          <div className="rail-bottom">
            <button className="rail-profile" type="button" onClick={() => setAccountOpen(true)}>
              <ProfileAvatar person={workspace.currentUser} token={session.accessToken} size={32} />
              <span>{workspace.currentUser.name}</span>
            </button>
          </div>
        </aside>

        <div className={`app-stage ${backgroundError ? "has-feedback" : ""}`}>
          <header className="global-bar">
            <SectionJump items={orderedNavItems} commands={[
              ...(canView("tasks") ? workspace.tasks.map(task => ({ id: `task:${task.id}`, label: task.title, context: `Задача · ${task.project}`, icon: <TaskListSquareLtr24Regular />, onSelect: () => { setFocusTarget(current => ({ section: "tasks", entityId: task.id, revision: (current?.revision ?? 0) + 1 })); setActiveSection("tasks"); } })) : []),
              ...(canView("messenger") ? workspace.chats.map(chat => ({ id: `chat:${chat.id}`, label: chat.title, context: "Рабочий чат", icon: <Chat24Regular />, onSelect: () => { setFocusTarget(current => ({ section: "messenger", entityId: chat.id, revision: (current?.revision ?? 0) + 1 })); setActiveSection("messenger"); } })) : []),
            ]} onNavigate={(key) => {
              if (key === "settings") { setAccountOpen(true); return; }
              setFocusTarget(undefined); setActiveSection(key);
            }} />
            <div className="workspace-top-context"><ConnectionIndicator detail={connectionDetail} error={Boolean(backgroundError)} /><WorkspaceIdentity person={workspace.currentUser} token={session.accessToken} onSettings={() => setAccountOpen(true)} onLogout={() => void handleLogout()} /></div>
          </header>

          {backgroundError ? <div className="workspace-feedback" role="alert">
            <span>{backgroundError}</span>
            <Button size="small" onClick={() => void refreshWorkspace(session.accessToken).catch(reportError)}>Обновить данные</Button>
            <Button size="small" appearance="subtle" aria-label="Закрыть сообщение об ошибке" onClick={() => setBackgroundError("")}>×</Button>
          </div> : null}

          <main className="app-content" id="workspace-content" tabIndex={-1}>
            <RecoveryBoundary key={`${session.user.id}:${displayedSection}`} onHome={() => setActiveSection("messenger")}>
            {displayedSection === "notifications" ? (
              <NotificationCenter
                notifications={workspace.notifications}
                preferences={workspace.notificationPreferences}
                onOpen={openNotification}
                onMarkRead={handleMarkNotificationRead}
                onMarkAllRead={handleMarkAllNotificationsRead}
                onUpdatePreferences={handleNotificationPreferences}
                absenceRequests={workspace.absenceRequests}
                onAbsenceAction={async (absenceRequest, action) => {
                  await handleAbsenceAction(absenceRequest, action);
                }}
              />
            ) : null}
            {displayedSection === "crm" ? (
              <ModulePreview
                icon={<Building24Regular />}
                title="CRM"
                evidence="CRM пока не используется. Этот раздел сохранён в меню; рабочие задачи, проекты и согласования доступны в своих разделах."
                packageLabel="Раздел отложен"
              />
            ) : null}
            {displayedSection === "zoom_meetings" ? (
              <ZoomView
                key={focusTarget?.revision}
                token={session.accessToken}
                people={workspace.people}
                currentUserId={workspace.currentUser.id}
                registry={zoomRegistry}
                loading={zoomLoading}
                error={zoomError}
                onRefresh={() => void refreshZoom()}
                focusMeetingId={focusTarget?.section === "zoom_meetings" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {displayedSection === "messenger" ? (
              <MessengerView
                key={focusTarget?.revision}
                token={session.accessToken}
                chats={workspace.chats}
                personalPreferences={workspace.personalPreferences}
                onPersonalChat={(chatId, action) => personalMutation((token) => changePersonalChat(token, chatId, action))}
                onPinnedOrder={(order) => personalMutation((token) => reorderPinnedChats(token, order, workspace.personalPreferences.revision))}
                messages={workspace.messages}
                tasks={workspace.tasks}
                attachments={workspace.attachments}
                people={workspace.people}
                onSendMessage={handleSendMessage}
                onSendVoiceMessage={handleSendVoiceMessage}
                onReactMessage={handleMessageReaction}
                onPinMessage={handleMessagePin}
                currentUserId={workspace.currentUser.id}
                currentUserRole={workspace.currentUser.role}
                chatActions={chatActions}
                onEditMessage={async (message, body) => { await messengerMutation((token) => editWorkspaceMessage(token, message, body)); }}
                onDeleteMessage={async (message) => { await messengerMutation((token) => deleteWorkspaceMessage(token, message)); }}
                onCreateTaskFromMessage={handleCreateTaskFromMessage}
                onDownloadAttachment={handleDownloadAttachment}
                onLoadAttachment={handleLoadAttachment}
                onMarkRead={handleMarkChatRead}
                focusChatId={focusTarget?.section === "messenger" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {displayedSection === "tasks" ? (
              <TasksView
                key={focusTarget?.revision}
                tasks={workspace.tasks}
                attachments={workspace.attachments}
                people={workspace.people}
                currentUserId={workspace.currentUser.id}
                efficiency={efficiency}
                efficiencyLoading={efficiencyLoading}
                efficiencyError={efficiencyError}
                onLoadEfficiency={handleLoadEfficiency}
                onCreateTask={handleCreateTask}
                onCreateSubtask={handleCreateSubtask}
                onChangeStatus={handleTaskStatus}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onSetParticipant={handleSetTaskParticipant}
                onRemoveParticipant={handleRemoveTaskParticipant}
                onAddChecklistItem={handleAddChecklistItem}
                onToggleChecklistItem={handleToggleChecklistItem}
                onDeleteChecklistItem={handleDeleteChecklistItem}
                onAddComment={handleAddTaskComment}
                onReactToComment={handleTaskCommentReaction}
                onSetDependency={handleSetTaskDependency}
                onRemoveDependency={handleRemoveTaskDependency}
                onSetCycle={handleSetTaskCycle}
                renderTaskChat={(task) => task.chatId ? <EmbeddedConversation
                  chatId={task.chatId}
                  token={session.accessToken}
                  chats={workspace.chats}
                  personalPreferences={workspace.personalPreferences}
                  messages={workspace.messages}
                  tasks={workspace.tasks}
                  attachments={workspace.attachments}
                  people={workspace.people}
                  onSendMessage={handleSendMessage}
                  onSendVoiceMessage={handleSendVoiceMessage}
                  onReactMessage={handleMessageReaction}
                  onPinMessage={handleMessagePin}
                  currentUserId={workspace.currentUser.id}
                  currentUserRole={workspace.currentUser.role}
                  chatActions={chatActions}
                  onEditMessage={async (message, body) => { await messengerMutation((token) => editWorkspaceMessage(token, message, body)); }}
                  onDeleteMessage={async (message) => { await messengerMutation((token) => deleteWorkspaceMessage(token, message)); }}
                  onCreateTaskFromMessage={handleCreateTaskFromMessage}
                  onDownloadAttachment={handleDownloadAttachment}
                  onLoadAttachment={handleLoadAttachment}
                  onMarkRead={handleMarkChatRead}
                /> : <div className="embedded-chat-unavailable">Для этой задачи чат недоступен.</div>}
                onReturnForRevision={handleReturnTaskForRevision}
                onSubmitResult={handleSubmitTaskResult}
                onAcceptResult={handleAcceptTaskResult}
                onSetEfficiencyExclusion={handleTaskEfficiencyExclusion}
                onCreateApprovalFromTask={handleCreateApprovalFromTask}
                onUploadAttachments={handleUploadTaskAttachments}
                onDownloadAttachment={handleDownloadAttachment}
                focusTaskId={focusTarget?.section === "tasks" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {displayedSection === "payment_requests" && workspace.workflow ? (
              <ApprovalsView
                key={JSON.stringify([workspace.workflow, focusTarget?.revision])}
                canManage={
                  ["admin", "superadmin"].includes(workspace.currentUser.role)
                  && (modulePermissions.payment_requests?.admin ?? true)
                }
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
                onDeleteRequest={handleDeleteApproval}
                onReviseRequest={handleReviseApproval}
                onUploadAttachments={handleUploadApprovalAttachments}
                onDownloadAttachment={handleDownloadAttachment}
                focusRequestId={focusTarget?.section === "payment_requests" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {displayedSection === "feed" ? (
              <FeedView
                posts={workspace.feedPosts}
                people={workspace.people}
                token={session.accessToken}
                currentUserId={workspace.currentUser.id}
                onCreate={handleCreateFeedPost}
                onComment={handleFeedComment}
                onReact={handleFeedReaction}
                onDeleteComment={handleFeedCommentDelete}
                onPin={handleFeedPin}
                onDelete={handleFeedDelete}
              />
            ) : null}
            {displayedSection === "projects" ? (
              <ProjectsView
                projects={workspace.projects}
                people={workspace.people}
                currentUser={workspace.currentUser}
                onCreate={handleCreateProject}
                onUpdate={handleUpdateProject}
                onMove={handleMoveProject}
                onOpenChat={(chatId) => void handleOpenContextChat(chatId)}
              />
            ) : null}
            {displayedSection === "trip_approvals" ? (
              <TripApprovalsView
                key={focusTarget?.revision}
                requests={workspace.tripRequests}
                people={workspace.people}
                currentUser={workspace.currentUser}
                onCreate={handleCreateTrip}
                onUpdate={handleUpdateTrip}
                onAction={handleTripAction}
                onOpenChat={(chatId) => void handleOpenContextChat(chatId)}
                focusRequestId={focusTarget?.section === "trip_approvals" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {displayedSection === "calendar" ? (
              <CalendarView
                key={focusTarget?.revision}
                events={workspace.calendarEvents}
                tasks={workspace.tasks}
                onOpenTask={(taskId) => {
                  setFocusTarget((current) => ({ section: "tasks", entityId: taskId, revision: (current?.revision ?? 0) + 1 }));
                  setActiveSection("tasks");
                }}
                zoomMeetings={zoomRegistry?.meetings}
                onOpenZoomMeeting={(meetingId) => {
                  setFocusTarget((current) => ({ section: "zoom_meetings", entityId: meetingId, revision: (current?.revision ?? 0) + 1 }));
                  setActiveSection("zoom_meetings");
                }}
                people={workspace.people}
                currentUserId={workspace.currentUser.id}
                onCreate={handleCreateCalendarEvent}
                onUpdate={handleUpdateCalendarEvent}
                onCancel={handleCancelCalendarEvent}
                focusEventId={focusTarget?.section === "calendar" ? focusTarget.entityId : undefined}
              />
            ) : null}
            {displayedSection === "absences" ? (
              <AbsencesView
                currentUserId={workspace.currentUser.id}
                people={workspace.people}
                requests={workspace.absenceRequests}
                summary={workspace.presenceSummary}
                canAdmin={modulePermissions.absences?.admin === true}
                onCreate={handleCreateAbsence}
                onAction={handleAbsenceAction}
                onUploadDocument={async (requestId, file) => {
                  await uploadFiles("absence", requestId, [file]);
                }}
              />
            ) : null}
            {displayedSection === "members" ? (
              <MembersView
                registry={membersRegistry}
                loading={membersLoading}
                error={membersError}
                onRefresh={() => void refreshMembers()}
              />
            ) : null}
            {displayedSection === "employees" ? (
              <EmployeesView
                token={session.accessToken}
                currentUser={workspace.currentUser}
                allowAdministration={modulePermissions.employees?.admin ?? ["admin", "superadmin"].includes(workspace.currentUser.role)}
                allowChatAdministration={Boolean(modulePermissions.messenger?.admin) && ["admin", "superadmin"].includes(workspace.currentUser.role)}
                onInvite={() => { setAccountInvite(true); setAccountOpen(true); }}
                onCreateChat={chatActions.create}
                onChatCreated={(chatId) => {
                  setFocusTarget((current) => ({ section: "messenger", entityId: chatId, revision: (current?.revision ?? 0) + 1 }));
                  setActiveSection("messenger");
                }}
              />
            ) : null}
            </RecoveryBoundary>
          </main>
        </div>
      </div>
      {accountOpen ? (
        <RecoveryBoundary overlay onHome={closeAccount}>
        <AccountPanel
          token={session.accessToken}
          user={workspace.currentUser}
          onClose={closeAccount}
          initialSection={accountInvite ? "invite" : undefined}
          onLogout={() => void handleLogout()}
          onAvatarChanged={(avatarVersion) => setWorkspace((current) => ({
            ...current,
            currentUser: { ...current.currentUser, avatarVersion },
            people: current.people.map((person) => person.id === current.currentUser.id ? { ...person, avatarVersion } : person),
          }))}
        />
        </RecoveryBoundary>
      ) : null}
      <WebUpdateNotice />
    </FluentProvider>
  );
}
