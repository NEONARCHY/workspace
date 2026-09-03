import { useEffect, useState, type ReactNode } from "react";

import type { WorkspaceSection } from "@yuksalish/contracts";
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
import { MessengerView } from "./MessengerView";
import { loadModuleCatalog } from "./module-catalog";
import { TasksView } from "./TasksView";

interface NavItem {
  readonly key: WorkspaceSection;
  readonly label: string;
  readonly icon: ReactNode;
  readonly activeIcon: ReactNode;
  readonly badge?: number;
}

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

  useEffect(() => {
    let active = true;
    void loadModuleCatalog()
      .then(() => {
        if (active) setOnline(true);
      })
      .catch(() => {
        if (active) setOnline(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
            <Avatar name="Азиза Каримова" size={36} color="colorful" />
          </div>
        </aside>

        <div className="app-stage">
          <header className="global-bar">
            <div className="global-brand">
              <strong>Yuksalish Workspace</strong>
              <span className={`connection-state ${online ? "online" : ""}`}>
                {online ? "Сервер подключён" : "Демонстрационный режим"}
              </span>
            </div>
            <Input
              aria-label="Глобальный поиск"
              className="global-search"
              contentBefore={<Search24Regular />}
              placeholder="Найти сообщение, задачу или заявку"
            />
            <Button appearance="subtle">Помощь</Button>
          </header>

          <main className="app-content">
            {activeSection === "messenger" ? <MessengerView /> : null}
            {activeSection === "tasks" ? <TasksView /> : null}
            {activeSection === "approvals" ? <ApprovalsView /> : null}
          </main>
        </div>
      </div>
    </FluentProvider>
  );
}
