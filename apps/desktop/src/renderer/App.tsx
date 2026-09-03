import { useCallback, useEffect, useState, type ReactNode } from "react";

import type {
  ApprovalRequestSummary,
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

import { ApprovalsView } from "./ApprovalsView";
import { initialChats, initialMessages, initialTasks, people } from "./demo-data";
import { MessengerView } from "./MessengerView";
import { TasksView } from "./TasksView";
import {
  actOnWorkspaceApproval,
  changeWorkspaceTaskStatus,
  createDevelopmentSession,
  createWorkspaceApproval,
  createWorkspaceTask,
  loadWorkspace,
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

export function App() {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("messenger");
  const [online, setOnline] = useState(false);
  const [connectionDetail, setConnectionDetail] = useState("Демонстрационный режим");
  const [testUsername, setTestUsername] = useState("aziza");
  const [token, setToken] = useState<string>();
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace);

  const refreshWorkspace = useCallback(async (accessToken: string) => {
    const loaded = await loadWorkspace(accessToken);
    setWorkspace(loaded);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void createDevelopmentSession(testUsername)
      .then(async (session) => {
        const loaded = await loadWorkspace(session.accessToken);
        if (!active) return;
        setToken(session.accessToken);
        setWorkspace(loaded);
        setOnline(true);
        setConnectionDetail("Сервер подключён");
        unsubscribe = subscribeToWorkspaceEvents(session.accessToken, () => {
          void refreshWorkspace(session.accessToken);
        });
      })
      .catch(() => {
        if (!active) return;
        setToken(undefined);
        setOnline(false);
        setWorkspace(initialWorkspace);
        setConnectionDetail("Демонстрационный режим");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshWorkspace, testUsername]);

  const reportError = (error: unknown) => {
    setConnectionDetail(error instanceof Error ? error.message : "Ошибка операции");
  };

  const handleSendMessage = async (chatId: string, body: string) => {
    if (token === undefined) {
      const localMessage: ChatMessage = {
        id: `local-${workspace.messages.length + 1}`,
        chatId,
        authorId: workspace.currentUser.id,
        body,
        time: new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
        own: true,
      };
      setWorkspace((current) => ({
        ...current,
        messages: [...current.messages, localMessage],
      }));
      return;
    }
    try {
      const message = await sendWorkspaceMessage(token, chatId, body);
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
    if (token === undefined) {
      const localTask: WorkspaceTask = {
        id: `local-task-${workspace.tasks.length + 1}`,
        title,
        project: "Без проекта",
        assigneeId: workspace.currentUser.id,
        dueLabel: "Срок не указан",
        status: "new",
        priority: "normal",
        checklistDone: 0,
        checklistTotal: 0,
      };
      setWorkspace((current) => ({ ...current, tasks: [localTask, ...current.tasks] }));
      return localTask;
    }
    try {
      const task = await createWorkspaceTask(token, {
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
    if (token === undefined) {
      setWorkspace((current) => ({
        ...current,
        tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
      }));
      return;
    }
    try {
      const task = await changeWorkspaceTaskStatus(token, taskId, status);
      setWorkspace((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
      }));
    } catch (error) {
      reportError(error);
    }
  };

  const handleSaveWorkflow = async (workflow: WorkflowDefinition) => {
    if (token === undefined) return;
    const saved = await saveWorkspaceWorkflow(token, workflow);
    setWorkspace((current) => ({ ...current, workflow: saved }));
  };

  const handleCreateApproval = async (title: string, amount: number) => {
    if (token === undefined) return undefined;
    try {
      const request = await createWorkspaceApproval(token, {
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
    if (token === undefined) return;
    try {
      const request = await actOnWorkspaceApproval(token, requestId, action);
      setWorkspace((current) => ({
        ...current,
        requests: current.requests.map((item) => (item.id === request.id ? request : item)),
      }));
    } catch (error) {
      reportError(error);
    }
  };

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
              <button className="rail-action" type="button" aria-label="Настройки">
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
              <span className={`connection-state ${online ? "online" : ""}`}>
                {connectionDetail}
              </span>
            </div>
            <Input
              aria-label="Глобальный поиск"
              className="global-search"
              contentBefore={<Search24Regular />}
              placeholder="Найти сообщение, задачу или заявку"
            />
            {online ? (
              <label className="test-user-select">
                <span>Тестовый вход</span>
                <select
                  aria-label="Тестовый пользователь"
                  value={testUsername}
                  onChange={(event) => setTestUsername(event.target.value)}
                >
                  <option value="aziza">Азиза</option>
                  <option value="baxtiyor">Бахтиёр</option>
                  <option value="dilshod">Дилшод</option>
                  <option value="malika">Малика</option>
                </select>
              </label>
            ) : null}
            <Button appearance="subtle">Помощь</Button>
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
    </FluentProvider>
  );
}
