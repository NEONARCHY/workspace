import { useMemo, useState } from "react";

import type {
  ApprovalRequestSummary,
  TaskParticipantRole,
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
  Textarea,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Calendar24Regular,
  Delete24Regular,
  Edit24Regular,
  Search20Regular,
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

const kanbanStatuses = ["new", "in_progress", "awaiting_review", "overdue", "completed"] as const;
type TaskFilter = "active" | "mine" | "overdue" | "completed";
type TaskMode = "list" | "kanban";

interface TaskEditPayload {
  readonly title: string;
  readonly description: string;
  readonly project: string;
  readonly assigneeId: string;
  readonly priority: WorkspaceTask["priority"];
  readonly dueAt?: string | null;
}

interface CyclePayload {
  readonly title: string;
  readonly scheduleKind: "daily" | "weekly" | "monthly";
  readonly interval: number;
  readonly nextRunAt?: string | null;
  readonly isEnabled: boolean;
}

interface TasksViewProps {
  readonly focusTaskId?: string;
  readonly tasks: readonly WorkspaceTask[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly onCreateTask: (title: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onChangeStatus: (taskId: string, status: TaskStatus) => void | Promise<void>;
  readonly onUpdateTask: (task: WorkspaceTask, payload: TaskEditPayload) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onSetParticipant: (task: WorkspaceTask, userId: string, role: TaskParticipantRole) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onRemoveParticipant: (task: WorkspaceTask, userId: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onAddChecklistItem: (task: WorkspaceTask, title: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onToggleChecklistItem: (task: WorkspaceTask, itemId: string, completed: boolean) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onDeleteChecklistItem: (task: WorkspaceTask, itemId: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onAddComment: (task: WorkspaceTask, body: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onSetDependency: (task: WorkspaceTask, dependsOnTaskId: string, dependencyKind: "blocks" | "relates") => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onRemoveDependency: (task: WorkspaceTask, dependsOnTaskId: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onSetCycle: (task: WorkspaceTask, payload: CyclePayload) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onCreateApprovalFromTask: (task: WorkspaceTask, title: string, amount: number) => ApprovalRequestSummary | undefined | Promise<ApprovalRequestSummary | undefined>;
  readonly onUploadAttachments: (task: WorkspaceTask, files: readonly File[]) => void | Promise<void>;
  readonly onDownloadAttachment: (attachment: WorkspaceAttachment) => void | Promise<void>;
}

function localDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function TasksView(props: TasksViewProps) {
  const {
    tasks, attachments, people, currentUserId, focusTaskId, onCreateTask, onChangeStatus, onUpdateTask,
    onSetParticipant, onRemoveParticipant, onAddChecklistItem, onToggleChecklistItem,
    onDeleteChecklistItem, onAddComment, onSetDependency, onRemoveDependency, onSetCycle,
    onCreateApprovalFromTask, onUploadAttachments, onDownloadAttachment,
  } = props;
  const [mode, setMode] = useState<TaskMode>("list");
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [query, setQuery] = useState("");
  const [selectedId, updateSelectedId] = useState(focusTaskId ?? tasks[0]?.id ?? "");
  const [detailOpen, setDetailOpen] = useState(Boolean(focusTaskId));
  const setSelectedId = (id: string) => { updateSelectedId(id); setDetailOpen(true); };
  const [dateError, setDateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editProject, setEditProject] = useState("");
  const [editAssigneeId, setEditAssigneeId] = useState("");
  const [editPriority, setEditPriority] = useState<WorkspaceTask["priority"]>("normal");
  const [editDueAt, setEditDueAt] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [participantRole, setParticipantRole] = useState<TaskParticipantRole>("co_assignee");
  const [checklistTitle, setChecklistTitle] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [dependencyKind, setDependencyKind] = useState<"blocks" | "relates">("blocks");
  const [cycleEditing, setCycleEditing] = useState(false);
  const [cycleKind, setCycleKind] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [cycleInterval, setCycleInterval] = useState("1");
  const [cycleNextRun, setCycleNextRun] = useState("");
  const [creatingApproval, setCreatingApproval] = useState(false);
  const [approvalTitle, setApprovalTitle] = useState("");
  const [approvalAmount, setApprovalAmount] = useState("");

  const visibleTasks = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("ru");
    const names = new Map(people.map((person) => [person.id, person.name]));
    return tasks.filter((task) => {
      const matchesFilter = filter === "mine" ? task.assigneeId === currentUserId
        : filter === "overdue" ? task.status === "overdue"
        : filter === "completed" ? task.status === "completed"
        : !["completed", "cancelled"].includes(task.status);
      return matchesFilter && (!search || `${task.title} ${task.project} ${names.get(task.assigneeId) ?? ""}`.toLocaleLowerCase("ru").includes(search));
    });
  }, [currentUserId, filter, tasks, query, people]);

  const selectedTask = tasks.find((task) => task.id === selectedId)
    ?? visibleTasks[0];
  const currentUser = people.find((person) => person.id === currentUserId);
  const privileged = ["manager", "admin", "superadmin"].includes(currentUser?.role ?? "");
  const coAssignee = selectedTask?.participants.some((item) => item.userId === currentUserId && item.role === "co_assignee") ?? false;
  const canEdit = selectedTask !== undefined && (privileged || selectedTask.authorId === currentUserId || selectedTask.assigneeId === currentUserId || coAssignee);
  const canManageParticipants = selectedTask !== undefined && (privileged || selectedTask.authorId === currentUserId);
  const personById = (id: string) => people.find((person) => person.id === id) ?? people[0];

  const createTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const task = await onCreateTask(title);
    if (task !== undefined) setSelectedId(task.id);
    setNewTitle("");
    setCreating(false);
  };

  const startEditing = () => {
    if (selectedTask === undefined) return;
    setEditTitle(selectedTask.title);
    setEditDescription(selectedTask.description ?? "");
    setEditProject(selectedTask.project);
    setEditAssigneeId(selectedTask.assigneeId);
    setEditPriority(selectedTask.priority);
    setEditDueAt(localDateTime(selectedTask.dueAt));
    setEditing(true);
  };

  const saveTask = async () => {
    if (selectedTask === undefined || !editTitle.trim() || !editAssigneeId) return;
    if (editDueAt && !Number.isFinite(new Date(editDueAt).getTime())) { setDateError("Проверьте срок задачи."); return; }
    setDateError("");
    const updated = await onUpdateTask(selectedTask, {
      title: editTitle.trim(), description: editDescription.trim(), project: editProject.trim() || "Без проекта",
      assigneeId: editAssigneeId, priority: editPriority,
      dueAt: editDueAt ? new Date(editDueAt).toISOString() : null,
    });
    if (updated !== undefined) setEditing(false);
  };

  const addParticipant = async () => {
    if (selectedTask === undefined || !participantId) return;
    if (await onSetParticipant(selectedTask, participantId, participantRole)) setParticipantId("");
  };

  const addChecklistItem = async () => {
    if (selectedTask === undefined || !checklistTitle.trim()) return;
    if (await onAddChecklistItem(selectedTask, checklistTitle.trim())) setChecklistTitle("");
  };

  const addComment = async () => {
    if (selectedTask === undefined || !commentBody.trim()) return;
    if (await onAddComment(selectedTask, commentBody.trim())) setCommentBody("");
  };

  const addDependency = async () => {
    if (selectedTask === undefined || !dependencyId) return;
    if (await onSetDependency(selectedTask, dependencyId, dependencyKind)) setDependencyId("");
  };

  const startCycleEditing = () => {
    if (selectedTask === undefined) return;
    const defaultNextRun = new Date();
    defaultNextRun.setDate(defaultNextRun.getDate() + 1);
    defaultNextRun.setHours(9, 0, 0, 0);
    setCycleKind(selectedTask.cycle?.scheduleKind ?? "monthly");
    setCycleInterval(String(selectedTask.cycle?.interval ?? 1));
    setCycleNextRun(
      localDateTime(selectedTask.cycle?.nextRunAt ?? defaultNextRun.toISOString()),
    );
    setCycleEditing(true);
  };

  const saveCycle = async () => {
    if (selectedTask === undefined) return;
    if (cycleNextRun && !Number.isFinite(new Date(cycleNextRun).getTime())) { setDateError("Проверьте дату следующего повторения."); return; }
    setDateError("");
    const interval = Number(cycleInterval);
    if (!Number.isInteger(interval) || interval < 1) return;
    if (await onSetCycle(selectedTask, {
      title: selectedTask.title, scheduleKind: cycleKind, interval,
      nextRunAt: cycleNextRun ? new Date(cycleNextRun).toISOString() : null, isEnabled: true,
    })) setCycleEditing(false);
  };

  const toggleCycle = async () => {
    if (selectedTask?.cycle === undefined || selectedTask.cycle === null) return;
    await onSetCycle(selectedTask, {
      title: selectedTask.cycle.title,
      scheduleKind: selectedTask.cycle.scheduleKind,
      interval: selectedTask.cycle.interval,
      nextRunAt: selectedTask.cycle.nextRunAt,
      isEnabled: !selectedTask.cycle.isEnabled,
    });
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
    if (await onCreateApprovalFromTask(selectedTask, approvalTitle.trim(), amount)) setCreatingApproval(false);
  };

  return (
    <section className={`workspace-view tasks-view bp5-tasks ${detailOpen && selectedTask ? "detail-open" : ""}`} aria-label="Задачи">
      <div className="tasks-main">
        <header className="section-toolbar">
          <div><h1>Задачи</h1><p>Карточки, команда, сроки и зависимости</p></div>
          <div className="task-toolbar-actions">
            <div className="view-switch" aria-label="Представление задач">
              <button className={mode === "list" ? "active" : ""} aria-pressed={mode === "list"} onClick={() => setMode("list")} type="button">Список</button>
              <button className={mode === "kanban" ? "active" : ""} aria-pressed={mode === "kanban"} onClick={() => setMode("kanban")} type="button">Kanban</button>
            </div>
            <Button appearance="primary" icon={<Add24Regular />} onClick={() => setCreating(true)}>Новая задача</Button>
          </div>
        </header>

        <div className="task-filters" aria-label="Фильтры задач">
          {([ ["active", "Активные"], ["mine", "Мои"], ["overdue", "Просроченные"], ["completed", "Завершённые"] ] as const).map(([key, label]) => (
            <button className={filter === key ? "active" : ""} aria-pressed={filter === key} key={key} onClick={() => setFilter(key)} type="button">{label}</button>
          ))}
          <Input className="task-search" aria-label="Поиск задач" contentBefore={<Search20Regular />} placeholder="Название, проект, исполнитель" value={query} onChange={(_, data) => setQuery(data.value)} />
        </div>

        {creating ? <div className="quick-create" role="region" aria-label="Создание задачи">
          <Input autoFocus aria-label="Название задачи" placeholder="Что нужно сделать?" value={newTitle} onChange={(_event, data) => setNewTitle(data.value)} onKeyDown={(event) => { if (event.key === "Enter") void createTask(); if (event.key === "Escape") setCreating(false); }} />
          <Button appearance="primary" onClick={() => void createTask()} disabled={!newTitle.trim()}>Создать</Button>
          <Button appearance="subtle" onClick={() => setCreating(false)}>Отмена</Button>
        </div> : null}

        {mode === "list" ? <TaskList tasks={visibleTasks} selectedId={selectedTask?.id} personById={personById} onSelect={setSelectedId} /> : (
          <div className="task-kanban" aria-label="Kanban задач">
            {kanbanStatuses.map((status) => <section className="kanban-column" data-task-status={status} key={status} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const taskId = event.dataTransfer.getData("text/task-id"); if (taskId) void onChangeStatus(taskId, status); }}>
              <header><strong>{statusLabels[status]}</strong><Badge appearance="filled">{visibleTasks.filter((task) => task.status === status).length}</Badge></header>
              <div className="kanban-stack">{visibleTasks.filter((task) => task.status === status).map((task) => <button className={`kanban-card ${selectedTask?.id === task.id ? "selected" : ""}`} draggable key={task.id} onClick={() => setSelectedId(task.id)} onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)} type="button"><strong>{task.title}</strong><span>{task.project}</span><small>{task.dueLabel}</small><ProgressBar aria-label={`Чек-лист: ${task.title}`} value={task.checklistTotal ? task.checklistDone / task.checklistTotal : 0} /></button>)}</div>
            </section>)}
          </div>
        )}
        {visibleTasks.length === 0 && mode === "list" ? <div className="empty-state"><strong>В этом разделе задач нет</strong><span>Переключите фильтр или создайте новую задачу.</span></div> : null}
      </div>

      {selectedTask !== undefined ? <aside className="task-detail task-card-full">
        <Button className="compact-back" appearance="subtle" onClick={() => setDetailOpen(false)}>К списку задач</Button>
        {dateError ? <div className="auth-error" role="alert">{dateError}</div> : null}
        <div className="task-detail-heading"><div><div className="detail-kicker">{selectedTask.project}</div><h2>{selectedTask.title}</h2></div>{canEdit ? <Button appearance="subtle" icon={<Edit24Regular />} onClick={startEditing}>Редактировать карточку</Button> : null}</div>
        {selectedTask.sourceMessageId ? <div className="source-link-note">Создана из сообщения · связь сохранена</div> : null}
        <div className="detail-meta"><div><Avatar name={personById(selectedTask.assigneeId)?.name ?? "Сотрудник"} size={36} color="colorful" /><span><small>Ответственный</small><strong>{personById(selectedTask.assigneeId)?.name ?? "Сотрудник"}</strong></span></div><div><Calendar24Regular /><span><small>Срок</small><strong>{selectedTask.dueLabel}</strong></span></div></div>
        <label className="task-status-field"><span>Статус</span><select aria-label="Статус задачи" value={selectedTask.status} onChange={(event) => void onChangeStatus(selectedTask.id, event.target.value as TaskStatus)} disabled={!canEdit}>{Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>

        {editing ? <div className="task-card-editor" aria-label="Редактирование карточки задачи">
          <Input aria-label="Название в карточке" value={editTitle} onChange={(_event, data) => setEditTitle(data.value)} />
          <Textarea aria-label="Описание задачи" value={editDescription} onChange={(_event, data) => setEditDescription(data.value)} />
          <Input aria-label="Проект задачи" value={editProject} onChange={(_event, data) => setEditProject(data.value)} />
          <label><span>Ответственный</span><select aria-label="Ответственный задачи" value={editAssigneeId} onChange={(event) => setEditAssigneeId(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span>Приоритет</span><select aria-label="Приоритет задачи" value={editPriority} onChange={(event) => setEditPriority(event.target.value as WorkspaceTask["priority"])}><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option></select></label>
          <label><span>Срок</span><input aria-label="Срок задачи" type="datetime-local" value={editDueAt} onChange={(event) => setEditDueAt(event.target.value)} /></label>
          <div className="task-editor-actions"><Button appearance="primary" onClick={() => void saveTask()}>Сохранить карточку</Button><Button appearance="subtle" onClick={() => setEditing(false)}>Отмена</Button></div>
        </div> : <div className="detail-section"><h3>Описание</h3><p>{selectedTask.description || "Описание пока не добавлено."}</p></div>}

        <div className="detail-section task-participants-section"><div className="detail-section-line"><h3>Участники</h3><span>{selectedTask.participants.length + 1}</span></div><div className="participant-list">
          <ParticipantChip person={personById(selectedTask.assigneeId)} label="Ответственный" />
          {selectedTask.participants.map((participant) => <ParticipantChip key={`${participant.userId}-${participant.role}`} person={personById(participant.userId)} label={participant.role === "co_assignee" ? "Соисполнитель" : "Наблюдатель"} onRemove={canManageParticipants ? () => void onRemoveParticipant(selectedTask, participant.userId) : undefined} />)}
        </div>{canManageParticipants ? <div className="inline-task-form"><select aria-label="Новый участник" value={participantId} onChange={(event) => setParticipantId(event.target.value)}><option value="">Выберите сотрудника</option>{people.filter((person) => person.id !== selectedTask.assigneeId && !selectedTask.participants.some((item) => item.userId === person.id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><select aria-label="Роль участника" value={participantRole} onChange={(event) => setParticipantRole(event.target.value as TaskParticipantRole)}><option value="co_assignee">Соисполнитель</option><option value="observer">Наблюдатель</option></select><Button appearance="secondary" onClick={() => void addParticipant()} disabled={!participantId}>Добавить</Button></div> : null}</div>

        <AttachmentPanel attachments={attachments.filter((attachment) => attachment.ownerType === "task" && attachment.ownerId === selectedTask.id)} canUpload={canEdit} onUpload={(files) => onUploadAttachments(selectedTask, files)} onDownload={onDownloadAttachment} />

        <div className="detail-section task-checklist-section"><div className="detail-section-line"><h3>Чек-лист</h3><span>{selectedTask.checklistDone}/{selectedTask.checklistTotal}</span></div><ProgressBar aria-label="Выполнено пунктов чек-листа" value={selectedTask.checklistTotal ? selectedTask.checklistDone / selectedTask.checklistTotal : 0} /><div className="checklist-items">{selectedTask.checklist.map((item) => <div className="checklist-row" key={item.id}><Checkbox checked={item.isCompleted} disabled={!canEdit} label={item.title} onChange={(_event, data) => void onToggleChecklistItem(selectedTask, item.id, data.checked === true)} />{canEdit ? <button aria-label={`Удалить пункт ${item.title}`} onClick={() => void onDeleteChecklistItem(selectedTask, item.id)} type="button"><Delete24Regular /></button> : null}</div>)}</div>{canEdit ? <div className="inline-task-form"><Input aria-label="Новый пункт чек-листа" placeholder="Добавить пункт" value={checklistTitle} onChange={(_event, data) => setChecklistTitle(data.value)} /><Button appearance="secondary" onClick={() => void addChecklistItem()} disabled={!checklistTitle.trim()}>Добавить</Button></div> : null}</div>

        <div className="detail-section task-dependencies-section"><div className="detail-section-line"><h3>Зависимости</h3><span>{selectedTask.dependencies.length}</span></div>{selectedTask.dependencies.map((dependency) => <div className="dependency-row" key={dependency.dependsOnTaskId}><span><strong>{dependency.title}</strong><small>{dependency.dependencyKind === "blocks" ? "Блокирует выполнение" : "Связанная задача"}</small></span><Badge appearance="tint" color={dependency.status === "completed" ? "success" : "warning"}>{statusLabels[dependency.status]}</Badge>{canEdit ? <button aria-label={`Убрать зависимость ${dependency.title}`} onClick={() => void onRemoveDependency(selectedTask, dependency.dependsOnTaskId)} type="button">×</button> : null}</div>)}{canEdit ? <div className="inline-task-form"><select aria-label="Зависимая задача" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}><option value="">Выберите задачу</option>{tasks.filter((task) => task.id !== selectedTask.id && !selectedTask.dependencies.some((item) => item.dependsOnTaskId === task.id)).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><select aria-label="Тип зависимости" value={dependencyKind} onChange={(event) => setDependencyKind(event.target.value as "blocks" | "relates")}><option value="blocks">Блокирует</option><option value="relates">Связана</option></select><Button appearance="secondary" onClick={() => void addDependency()} disabled={!dependencyId}>Связать</Button></div> : null}</div>

        <div className="detail-section task-cycle-section"><div className="detail-section-line"><h3>Повторение</h3>{canEdit ? <span className="cycle-actions"><Button appearance="subtle" onClick={startCycleEditing}>{selectedTask.cycle ? "Настроить" : "Добавить цикл"}</Button>{selectedTask.cycle ? <Button appearance="subtle" onClick={() => void toggleCycle()}>{selectedTask.cycle.isEnabled ? "Отключить" : "Включить"}</Button> : null}</span> : null}</div>{selectedTask.cycle ? <div className={`cycle-summary ${selectedTask.cycle.isEnabled ? "" : "disabled"}`}><span><strong>{selectedTask.cycle.isEnabled ? "" : "Отключено · "}{selectedTask.cycle.scheduleKind === "daily" ? "Каждый день" : selectedTask.cycle.scheduleKind === "weekly" ? "Каждую неделю" : "Каждый месяц"}{selectedTask.cycle.interval > 1 ? ` · интервал ${selectedTask.cycle.interval}` : ""}</strong><small>Следующая задача: {selectedTask.cycle.nextRunAt ? new Date(selectedTask.cycle.nextRunAt).toLocaleString("ru-RU") : "не запланирована"}</small></span></div> : <p>Задача не повторяется.</p>}{cycleEditing ? <div className="inline-task-form cycle-form"><select aria-label="Период повторения" value={cycleKind} onChange={(event) => setCycleKind(event.target.value as typeof cycleKind)}><option value="daily">Дни</option><option value="weekly">Недели</option><option value="monthly">Месяцы</option></select><Input aria-label="Интервал повторения" type="number" min={1} value={cycleInterval} onChange={(_event, data) => setCycleInterval(data.value)} /><input aria-label="Следующее повторение" type="datetime-local" value={cycleNextRun} onChange={(event) => setCycleNextRun(event.target.value)} /><Button appearance="primary" onClick={() => void saveCycle()}>Сохранить цикл</Button><Button appearance="subtle" onClick={() => setCycleEditing(false)}>Отмена</Button></div> : null}</div>

        <div className="detail-section task-comments-section"><div className="detail-section-line"><h3>Комментарии</h3><span>{selectedTask.comments.length}</span></div><div className="task-comment-list">{selectedTask.comments.map((comment) => <div className="task-comment" key={comment.id}><Avatar name={personById(comment.authorUserId)?.name ?? ""} size={28} /><span><strong>{personById(comment.authorUserId)?.name}</strong><small>{new Date(comment.createdAt).toLocaleString("ru-RU")}</small><p>{comment.body}</p></span></div>)}</div><div className="task-comment-composer"><Textarea aria-label="Новый комментарий" placeholder="Написать комментарий" value={commentBody} onChange={(_event, data) => setCommentBody(data.value)} /><Button appearance="primary" onClick={() => void addComment()} disabled={!commentBody.trim()}>Отправить</Button></div></div>

        <div className="detail-footer"><Button appearance="secondary" icon={<Money24Regular />} onClick={startApproval}>Создать заявку на оплату</Button></div>
        {creatingApproval ? <div className="linked-create-panel task-approval-create" role="region" aria-label="Заявка из задачи"><Money24Regular /><Input aria-label="Название заявки из задачи" value={approvalTitle} onChange={(_event, data) => setApprovalTitle(data.value)} /><Input aria-label="Сумма заявки из задачи" inputMode="numeric" placeholder="Сумма в UZS" value={approvalAmount} onChange={(_event, data) => setApprovalAmount(data.value)} /><Button appearance="primary" onClick={() => void createApproval()}>Отправить по маршруту</Button><Button appearance="subtle" onClick={() => setCreatingApproval(false)}>Отмена</Button></div> : null}
      </aside> : null}
    </section>
  );
}

function TaskList({ tasks, selectedId, personById, onSelect }: {
  readonly tasks: readonly WorkspaceTask[];
  readonly selectedId?: string;
  readonly personById: (id: string) => WorkspacePerson | undefined;
  readonly onSelect: (id: string) => void;
}) {
  return <div className="task-table" role="region" aria-label="Список задач"><div className="task-table-head" aria-hidden="true"><span>Задача</span><span>Ответственный</span><span>Срок</span><span>Статус</span></div>{tasks.map((task) => { const assignee = personById(task.assigneeId); return <button className={`task-row ${selectedId === task.id ? "selected" : ""}`} key={task.id} onClick={() => onSelect(task.id)} type="button"><span className="task-title-cell"><strong>{task.title}</strong><small>{task.project}{task.cycle ? " · повторяется" : ""}</small></span><span className="person-cell"><Avatar name={assignee?.name ?? "Сотрудник"} size={28} color="colorful" /><span>{assignee?.name.split(" ")[0] ?? "Сотрудник"}</span></span><span className={task.status === "overdue" ? "danger-text" : ""}>{task.dueLabel}</span><Badge appearance="tint" color={task.status === "overdue" ? "danger" : task.status === "completed" ? "success" : "brand"}>{statusLabels[task.status]}</Badge></button>; })}</div>;
}

function ParticipantChip({ person, label, onRemove }: {
  readonly person?: WorkspacePerson;
  readonly label: string;
  readonly onRemove?: () => void;
}) {
  return <div className="participant-chip"><Avatar name={person?.name ?? "Сотрудник"} size={24} /><span>{person?.name ?? "Сотрудник"}<small>{label}</small></span>{onRemove ? <button aria-label={`Убрать участника ${person?.name ?? ""}`} onClick={onRemove} type="button">×</button> : null}</div>;
}
