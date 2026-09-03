import { useCallback, useEffect, useState, type ReactNode } from "react";

import type {
  ApprovalRequestSummary,
  AuthenticationSession,
  ChatMessage,
  TaskStatus,
  WorkflowDefinition,
  WorkspacePerson,
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
  Briefcase24Regular,
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
import { initialChats, initialMessages, initialTasks, people } from "./demo-data";
import { EmployeesView } from "./EmployeesView";
import { LoginView } from "./LoginView";
import { MessengerView } from "./MessengerView";
import { TasksView } from "./TasksView";
import {
  acceptInvitation,
  actOnWorkspaceApproval,
  changeWorkspaceTaskStatus,
  completePasswordReset,
  createWorkspaceApproval,
  createWorkspaceTask,
  loadWorkspace,
  login,
  logout,
  refreshAuthentication,
  saveWorkspaceWorkflow,
  sendWorkspaceMessage,
  subscribeToWorkspaceEvents,
} from "./workspace-api";

interface NavItem {
  readonly key: WorkspaceSection;
  readonly label: string;
  readonly icon: ReactNode;
}

interface WorkspaceState {
  readonly currentUser: WorkspacePerson;
  readonly people: readonly WorkspacePerson[];
  readonly chats: typeof initialChats;
  readonly messages: readonly ChatMessage[];
  readonly tasks: readonly WorkspaceTask[];
  readonly requests: readonly ApprovalRequestSummary[];
  readonly workflow?: WorkflowDefinition;
}

const initialWorkspace: WorkspaceState = {
  currentUser: people[0]!,
  people,
  chats: initialChats,
  messages: initialMessages,
  tasks: initialTasks,
  requests: [],
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
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("messenger");
  const [connectionDetail, setConnectionDetail] = useState("Сервер подключён");
  const [session, setSession] = useState<AuthenticationSession>();
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);

  const refreshWorkspace = useCallback(async (accessToken: string) => {
    const loaded = await loadWorkspace(accessToken);
    setWorkspace(loaded);
  }, []);

  const establishSession = async (authenticated: AuthenticationSession) => {
    const loaded = await loadWorkspace(authenticated.accessToken);
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
    if (current !== undefined) {
      await logout(current.accessToken).catch(() => undefined);
    }
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
    return subscribeToWorkspaceEvents(session.accessToken, () => {
      void refreshWorkspace(session.accessToken);
    });
  }, [refreshWorkspace, session]);

  const reportError = (error: unknown) => {
    setConnectionDetail(error instanceof Error ? error.message : "Ошибка операции");
  };

  const handleSendMessage = async (chatId: string, body: string) => {
    if (session === undefined) return;
    try {
      const message = await sendWorkspaceMessage(session.accessToken, chatId, body);
      setWorkspace((current) =>
        current.messages.some((item) => item.id === message.id)
          ? current
          : { ...current, messages: [...current.messages, message] },
      );
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

  const handleSaveWorkflow = async (workflow: WorkflowDefinition) => {
    if (session === undefined) return;
    const saved = await saveWorkspaceWorkflow(session.accessToken, workflow);
    setWorkspace((current) => ({ ...current, workflow: saved }));
  };

  const handleCreateApproval = async (title: string, amount: number) => {
    if (session === undefined) return undefined;
    try {
      const request = await createWorkspaceApproval(session.accessToken, {
        title,
        amount,
        currency: "UZS",
        purpose: title,
      });
      setWorkspace((current) => ({ ...current, requests: [request, ...current.requests] }));
      return request;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  const handleApprovalAction = async (
    requestId: string,
    action: "approve" | "reject" | "return" | "resubmit",
  ) => {
    if (session === undefined) return;
    try {
      const request = await actOnWorkspaceApproval(session.accessToken, requestId, action);
      setWorkspace((current) => ({
        ...current,
        requests: current.requests.map((item) => (item.id === request.id ? request : item)),
      }));
    } catch (error) {
      reportError(error);
    }
  };

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
                  onClick={() => setActiveSection(item.key)}
                >
                  <span className="rail-icon">{icon}</span>
                  <span className="rail-label">{item.label}</span>
                  {badge ? <span className="rail-badge">{badge > 99 ? "99+" : badge}</span> : null}
                </button>
              );
            })}
          </nav>
          <div className="rail-bottom">
            <button className="rail-action" type="button" aria-label="Уведомления">
              <span className="rail-icon"><Alert24Regular /></span>
              <span className="rail-label">Уведомления</span>
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
                chats={workspace.chats}
                messages={workspace.messages}
                people={workspace.people}
                onSendMessage={handleSendMessage}
              />
            ) : null}
            {activeSection === "tasks" ? (
              <TasksView
                tasks={workspace.tasks}
                people={workspace.people}
                currentUserId={workspace.currentUser.id}
                onCreateTask={handleCreateTask}
                onChangeStatus={handleTaskStatus}
              />
            ) : null}
            {activeSection === "payment_requests" ? (
              <ApprovalsView
                key={workspace.workflow === undefined ? "offline" : JSON.stringify(workspace.workflow)}
                canManage={["manager", "admin", "superadmin"].includes(workspace.currentUser.role)}
                currentUserId={workspace.currentUser.id}
                requests={workspace.requests}
                workflow={workspace.workflow}
                onSaveWorkflow={handleSaveWorkflow}
                onCreateRequest={handleCreateApproval}
                onAction={handleApprovalAction}
              />
            ) : null}
            {activeSection === "feed" ? (
              <ModulePreview
                icon={<News24Regular />}
                title="Лента"
                evidence="Текущий webhook не разрешает безопасно прочитать структуру живой ленты. Потребуется отдельный read‑only доступ перед фиксацией точного поведения."
                packageLabel="Пакет BP‑8 · Лента, календарь и коммуникации"
              />
            ) : null}
            {activeSection === "projects" ? (
              <ModulePreview
                icon={<Briefcase24Regular />}
                title="Список проектов"
                evidence="В Bitrix найдено 6 проектов и пять стадий: Начало, Подготовка, Согласование, Успех и Провал."
                packageLabel="Пакет BP‑7 · Проекты и поездки"
              />
            ) : null}
            {activeSection === "trip_approvals" ? (
              <ModulePreview
                icon={<ApprovalsApp24Regular />}
                title="Согласование поездок"
                evidence="В Bitrix найден отдельный маршрут из пяти стадий и одна текущая карточка. Поля дат, цели и сотрудников зафиксированы в спецификации."
                packageLabel="Пакет BP‑7 · Проекты и поездки"
              />
            ) : null}
            {activeSection === "calendar" ? (
              <ModulePreview
                icon={<CalendarLtr24Regular />}
                title="Календарь"
                evidence="Webhook подтверждает один календарный раздел текущего пользователя. Содержимое событий не выгружалось."
                packageLabel="Пакет BP‑8 · Лента, календарь и коммуникации"
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
