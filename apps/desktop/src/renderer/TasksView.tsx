import { useMemo, useState } from "react";

import type {
  ApprovalRequestSummary,
  TaskStatus,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkspaceTask,
} from "@yuksalish/contracts";
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
  Money24Regular,
} from "@fluentui/react-icons";

import { AttachmentPanel } from "./AttachmentPanel";

const statusLabels: Readonly<Record<TaskStatus, string>> = {
  new: "Новые",
  in_progress: "В работе",
  awaiting_review: "На проверке",
  completed: "Завершены",
  overdue: "Просрочены",
  cancelled: "Отменены",
};

type TaskFilter = "active" | "mine" | "overdue" | "completed";

interface TasksViewProps {
  readonly tasks: readonly WorkspaceTask[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly onCreateTask: (
    title: string,
  ) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onChangeStatus: (taskId: string, status: TaskStatus) => void | Promise<void>;
  readonly onCreateApprovalFromTask: (
    task: WorkspaceTask,
    title: string,
    amount: number,
  ) => ApprovalRequestSummary | undefined | Promise<ApprovalRequestSummary | undefined>;
  readonly onUploadAttachments: (
    task: WorkspaceTask,
    files: readonly File[],
  ) => void | Promise<void>;
  readonly onDownloadAttachment: (attachment: WorkspaceAttachment) => void | Promise<void>;
}

export function TasksView({
  tasks,
  attachments,
  people,
  currentUserId,
  onCreateTask,
  onChangeStatus,
  onCreateApprovalFromTask,
  onUploadAttachments,
  onDownloadAttachment,
}: TasksViewProps) {
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [selectedId, setSelectedId] = useState(tasks[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creatingApproval, setCreatingApproval] = useState(false);
  const [approvalTitle, setApprovalTitle] = useState("");
  const [approvalAmount, setApprovalAmount] = useState("");

  const visibleTasks = useMemo(() => {
    if (filter === "mine") return tasks.filter((task) => task.assigneeId === currentUserId);
    if (filter === "overdue") return tasks.filter((task) => task.status === "overdue");
    if (filter === "completed") return tasks.filter((task) => task.status === "completed");
    return tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  }, [currentUserId, filter, tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? visibleTasks[0];

  const createTask = async () => {
    const title = newTitle.trim();
    if (title.length === 0) return;
    const task = await onCreateTask(title);
    if (task !== undefined) setSelectedId(task.id);
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
    void onChangeStatus(selectedTask.id, nextStatus);
  };

  const startApproval = () => {
    if (selectedTask === undefined) return;
    setApprovalTitle(selectedTask.title);
    setApprovalAmount("");
    setCreatingApproval(true);
  };

  const createApproval = async () => {
    if (selectedTask === undefined) return;
    const amount = Number(approvalAmount.replace(/\s/g, ""));
    if (!approvalTitle.trim() || !Number.isFinite(amount) || amount <= 0) return;
    const created = await onCreateApprovalFromTask(selectedTask, approvalTitle.trim(), amount);
    if (created !== undefined) setCreatingApproval(false);
  };

  const personById = (id: string) => people.find((person) => person.id === id) ?? people[0];

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
                if (event.key === "Enter") void createTask();
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <Button appearance="primary" onClick={() => void createTask()} disabled={newTitle.trim().length === 0}>
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
                  <Avatar name={assignee?.name ?? "Сотрудник"} size={28} color="colorful" />
                  <span>{assignee?.name.split(" ")[0] ?? "Сотрудник"}</span>
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
          {selectedTask.sourceMessageId ? (
            <div className="source-link-note">Создана из сообщения · связь сохранена</div>
          ) : null}
          <div className="detail-meta">
            <div>
              <Avatar
                name={personById(selectedTask.assigneeId)?.name ?? "Сотрудник"}
                size={36}
                color="colorful"
              />
              <span>
                <small>Ответственный</small>
                <strong>{personById(selectedTask.assigneeId)?.name ?? "Сотрудник"}</strong>
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
            <p>{selectedTask.description || "Описание пока не добавлено."}</p>
          </div>
          <AttachmentPanel
            attachments={attachments.filter(
              (attachment) => attachment.ownerType === "task" && attachment.ownerId === selectedTask.id,
            )}
            canUpload
            onUpload={(files) => onUploadAttachments(selectedTask, files)}
            onDownload={onDownloadAttachment}
          />
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
            <Button appearance="secondary" icon={<Money24Regular />} onClick={startApproval}>
              Создать заявку на оплату
            </Button>
          </div>
          {creatingApproval ? (
            <div className="linked-create-panel task-approval-create" role="region" aria-label="Заявка из задачи">
              <Money24Regular />
              <Input
                aria-label="Название заявки из задачи"
                value={approvalTitle}
                onChange={(_event, data) => setApprovalTitle(data.value)}
              />
              <Input
                aria-label="Сумма заявки из задачи"
                inputMode="numeric"
                placeholder="Сумма в UZS"
                value={approvalAmount}
                onChange={(_event, data) => setApprovalAmount(data.value)}
              />
              <Button appearance="primary" onClick={() => void createApproval()}>
                Отправить по маршруту
              </Button>
              <Button appearance="subtle" onClick={() => setCreatingApproval(false)}>Отмена</Button>
            </div>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
