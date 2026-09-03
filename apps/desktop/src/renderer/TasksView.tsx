import { useMemo, useState } from "react";

import type { TaskStatus, WorkspaceTask } from "@yuksalish/contracts";
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Input,
  ProgressBar,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Calendar24Regular,
  Checkmark24Regular,
  Clock24Regular,
  Filter24Regular,
} from "@fluentui/react-icons";

import { initialTasks, personById } from "./demo-data";

const statusLabels: Readonly<Record<TaskStatus, string>> = {
  new: "Новые",
  in_progress: "В работе",
  awaiting_review: "На проверке",
  completed: "Завершены",
  overdue: "Просрочены",
};

type TaskFilter = "active" | "mine" | "overdue" | "completed";

export function TasksView() {
  const [tasks, setTasks] = useState<readonly WorkspaceTask[]>(initialTasks);
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [selectedId, setSelectedId] = useState(initialTasks[0]!.id);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const visibleTasks = useMemo(() => {
    if (filter === "mine") return tasks.filter((task) => task.assigneeId === "aziza");
    if (filter === "overdue") return tasks.filter((task) => task.status === "overdue");
    if (filter === "completed") return tasks.filter((task) => task.status === "completed");
    return tasks.filter((task) => task.status !== "completed");
  }, [filter, tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? visibleTasks[0];

  const createTask = () => {
    const title = newTitle.trim();
    if (title.length === 0) return;
    const task: WorkspaceTask = {
      id: `local-task-${tasks.length + 1}`,
      title,
      project: "Без проекта",
      assigneeId: "aziza",
      dueLabel: "Срок не указан",
      status: "new",
      priority: "normal",
      checklistDone: 0,
      checklistTotal: 0,
    };
    setTasks((current) => [task, ...current]);
    setSelectedId(task.id);
    setNewTitle("");
    setCreating(false);
  };

  const advanceTask = () => {
    if (selectedTask === undefined) return;
    const nextStatus: TaskStatus =
      selectedTask.status === "new" || selectedTask.status === "overdue"
        ? "in_progress"
        : selectedTask.status === "in_progress"
          ? "awaiting_review"
          : "completed";
    setTasks((current) =>
      current.map((task) =>
        task.id === selectedTask.id ? { ...task, status: nextStatus } : task,
      ),
    );
  };

  return (
    <section className="workspace-view tasks-view" aria-label="Задачи">
      <div className="tasks-main">
        <header className="section-toolbar">
          <div>
            <h1>Задачи</h1>
            <p>Работа команды, сроки и результаты</p>
          </div>
          <Button appearance="primary" icon={<Add24Regular />} onClick={() => setCreating(true)}>
            Новая задача
          </Button>
        </header>

        <div className="task-filters" aria-label="Фильтры задач">
          {(
            [
              ["active", "Активные"],
              ["mine", "Мои"],
              ["overdue", "Просроченные"],
              ["completed", "Завершённые"],
            ] as const
          ).map(([key, label]) => (
            <button
              className={filter === key ? "active" : ""}
              key={key}
              onClick={() => setFilter(key)}
              type="button"
            >
              {label}
            </button>
          ))}
          <Button appearance="subtle" icon={<Filter24Regular />}>
            Фильтры
          </Button>
        </div>

        {creating ? (
          <div className="quick-create" role="region" aria-label="Создание задачи">
            <Input
              autoFocus
              aria-label="Название задачи"
              placeholder="Что нужно сделать?"
              value={newTitle}
              onChange={(_event, data) => setNewTitle(data.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createTask();
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <Button appearance="primary" onClick={createTask} disabled={newTitle.trim().length === 0}>
              Создать
            </Button>
            <Button appearance="subtle" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        ) : null}

        <div className="task-table" role="list">
          <div className="task-table-head" aria-hidden="true">
            <span>Задача</span>
            <span>Ответственный</span>
            <span>Срок</span>
            <span>Статус</span>
          </div>
          {visibleTasks.map((task) => {
            const assignee = personById(task.assigneeId);
            return (
              <button
                className={`task-row ${selectedTask?.id === task.id ? "selected" : ""}`}
                key={task.id}
                onClick={() => setSelectedId(task.id)}
                type="button"
              >
                <span className="task-title-cell">
                  <strong>{task.title}</strong>
                  <small>{task.project}</small>
                </span>
                <span className="person-cell">
                  <Avatar name={assignee.name} size={28} color="colorful" />
                  <span>{assignee.name.split(" ")[0]}</span>
                </span>
                <span className={task.status === "overdue" ? "danger-text" : ""}>
                  {task.dueLabel}
                </span>
                <Badge
                  appearance="tint"
                  color={task.status === "overdue" ? "danger" : task.status === "completed" ? "success" : "brand"}
                >
                  {statusLabels[task.status]}
                </Badge>
              </button>
            );
          })}
          {visibleTasks.length === 0 ? (
            <div className="empty-state">
              <Checkmark24Regular />
              <strong>В этом разделе задач нет</strong>
              <span>Переключите фильтр или создайте новую задачу.</span>
            </div>
          ) : null}
        </div>
      </div>

      {selectedTask !== undefined ? (
        <aside className="task-detail">
          <div className="detail-kicker">{selectedTask.project}</div>
          <h2>{selectedTask.title}</h2>
          <div className="detail-meta">
            <div>
              <Avatar
                name={personById(selectedTask.assigneeId).name}
                size={36}
                color="colorful"
              />
              <span>
                <small>Ответственный</small>
                <strong>{personById(selectedTask.assigneeId).name}</strong>
              </span>
            </div>
            <div>
              <Calendar24Regular />
              <span>
                <small>Срок</small>
                <strong>{selectedTask.dueLabel}</strong>
              </span>
            </div>
          </div>
          <div className="detail-section">
            <h3>Описание</h3>
            <p>
              Собрать документы, проверить условия и зафиксировать итог в карточке задачи.
              Обсуждение автоматически доступно в чате задачи.
            </p>
          </div>
          <div className="detail-section">
            <div className="detail-section-line">
              <h3>Чек-лист</h3>
              <span>
                {selectedTask.checklistDone}/{selectedTask.checklistTotal}
              </span>
            </div>
            <ProgressBar
              value={
                selectedTask.checklistTotal === 0
                  ? 0
                  : selectedTask.checklistDone / selectedTask.checklistTotal
              }
            />
            <Checkbox label="Проверить реквизиты" defaultChecked={selectedTask.checklistDone > 0} />
            <Checkbox label="Согласовать условия" defaultChecked={selectedTask.checklistDone > 1} />
            <Checkbox label="Прикрепить итоговый файл" />
          </div>
          <div className="detail-footer">
            <Button appearance="primary" icon={<Checkmark24Regular />} onClick={advanceTask}>
              {selectedTask.status === "awaiting_review" ? "Принять результат" : "Следующий статус"}
            </Button>
            <Button appearance="secondary" icon={<Clock24Regular />}>
              Открыть чат
            </Button>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
