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
  Tooltip,
  webLightTheme,
} from "@fluentui/react-components";
import {
  Alert24Regular,
  ApprovalsApp24Regular,
  Chat24Filled,
  Chat24Regular,
  Home24Regular,
  Search24Regular,
  Settings24Regular,
  TaskListSquareLtr24Filled,
  TaskListSquareLtr24Regular,
} from "@fluentui/react-icons";

import { AccountPanel } from "./AccountPanel";
import { ApprovalsView } from "./ApprovalsView";
import { initialChats, initialMessages, initialTasks, people } from "./demo-data";
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
  readonly activeIcon: ReactNode;
  readonly badge?: number;
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
  {
    key: "messenger",
    label: "Сообщения",
    icon: <Chat24Regular />,
    activeIcon: <Chat24Filled />,
    badge: 4,
  },
  {
    key: "tasks",
    label: "Задачи",
    icon: <TaskListSquareLtr24Regular />,
    activeIcon: <TaskListSquareLtr24Filled />,
    badge: 2,
  },
  {
    key: "approvals",
    label: "Согласования",
    icon: <ApprovalsApp24Regular />,
    activeIcon: <ApprovalsApp24Regular />,
    badge: 4,
  },
];

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

  return (
    <FluentProvider theme={webLightTheme} className="app-provider">
      <div className="app-shell">
        <aside className="app-rail" aria-label="Основная навигация">
          <div className="workspace-logo" aria-label="Yuksalish Workspace">Y</div>
          <Tooltip content="Главная" relationship="label" positioning="after">
            <button className="rail-action" type="button" aria-label="Главная">
              <Home24Regular />
            </button>
          </Tooltip>
          <nav className="rail-nav">
            {navItems.map((item) => (
              <Tooltip key={item.key} content={item.label} relationship="label" positioning="after">
                <button
                  className={`rail-action ${activeSection === item.key ? "active" : ""}`}
                  type="button"
                  aria-label={item.label}
                  aria-current={activeSection === item.key ? "page" : undefined}
                  onClick={() => setActiveSection(item.key)}
                >
                  {activeSection === item.key ? item.activeIcon : item.icon}
                  {item.badge !== undefined ? <span className="rail-badge">{item.badge}</span> : null}
                </button>
              </Tooltip>
            ))}
          </nav>
          <div className="rail-bottom">
            <Tooltip content="Уведомления" relationship="label" positioning="after">
              <button className="rail-action" type="button" aria-label="Уведомления">
                <Alert24Regular />
              </button>
            </Tooltip>
            <Tooltip content="Настройки" relationship="label" positioning="after">
              <button
                className="rail-action"
                type="button"
                aria-label="Настройки"
                onClick={() => setAccountOpen(true)}
              >
                <Settings24Regular />
              </button>
            </Tooltip>
            <Avatar name={workspace.currentUser.name} size={36} color="colorful" />
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
            {activeSection === "approvals" ? (
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
