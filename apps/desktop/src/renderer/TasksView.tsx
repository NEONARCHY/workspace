import { useMemo, useState } from "react";

import type {
  ApprovalRequestSummary,
  EfficiencyOverview,
  TaskParticipantRole,
  TaskEfficiencyExclusionReason,
  TaskReturnReason,
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
  DialogSurface,
  Textarea,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Board24Regular,
  Calendar24Regular,
  Chat24Regular,
  Delete24Regular,
  Edit24Regular,
  Search20Regular,
  Money24Regular,
} from "@fluentui/react-icons";

import { AttachmentPanel } from "./AttachmentPanel";
import { EfficiencyView } from "./EfficiencyView";
import { TaskCalendarView } from "./TaskCalendarView";
import { TaskRecords } from "./TaskRecords";
import { TeamDashboardView } from "./TeamDashboardView";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";

const statusLabels: Readonly<Record<TaskStatus, string>> = {
  new: "Новые",
  in_progress: "В работе",
  awaiting_review: "На проверке",
  completed: "Завершены",
  overdue: "Просрочены",
  cancelled: "Отменены",
};

const returnReasonLabels: Readonly<Record<string, string>> = {
  incomplete_result: "Результат неполный",
  requirements_not_met: "Требования не выполнены",
  corrections_required: "Нужны исправления",
  other: "Другая причина",
};

function reviewStatusLabel(status: TaskStatus): string {
  if (status === "awaiting_review") return "Ожидает решения";
  if (status === "completed") return "Принято";
  if (status === "cancelled") return "Закрыто";
  return "Готовится исполнителем";
}

function cycleLabel(cycle: NonNullable<WorkspaceTask["cycle"]>): string {
  if (cycle.scheduleKind === "calendar") {
    if (cycle.calendarRule === "month_days") {
      return `По числам месяца: ${cycle.monthDays?.join(", ") ?? "—"}`;
    }
    const labels = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
    return `По дням недели: ${cycle.weekdays?.map((day) => labels[day]).join(", ") ?? "—"}`;
  }
  const base = cycle.scheduleKind === "daily"
    ? "Каждый день"
    : cycle.scheduleKind === "weekly"
      ? "Каждую неделю"
      : "Каждый месяц";
  return cycle.interval > 1 ? `${base} · интервал ${cycle.interval}` : base;
}

const kanbanStatuses = ["new", "in_progress", "awaiting_review", "overdue", "completed"] as const;
type TaskFilter = "active" | "mine" | "overdue" | "completed";
type TaskMode = "dashboard" | "list" | "kanban" | "calendar" | "efficiency";

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
  readonly scheduleKind: "daily" | "weekly" | "monthly" | "calendar";
  readonly interval: number;
  readonly calendarRule?: "weekdays" | "month_days" | null;
  readonly weekdays?: readonly number[];
  readonly monthDays?: readonly number[];
  readonly nextRunAt?: string | null;
  readonly isEnabled: boolean;
}

interface TasksViewProps {
  readonly focusTaskId?: string;
  readonly tasks: readonly WorkspaceTask[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly people: readonly WorkspacePerson[];
  readonly accessibleChatIds: readonly string[];
  readonly currentUserId: string;
  readonly efficiency?: EfficiencyOverview;
  readonly efficiencyLoading: boolean;
  readonly efficiencyError?: string;
  readonly onLoadEfficiency: (period?: string) => void | Promise<void>;
  readonly onCreateTask: (title: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onCreateSubtask: (parent: WorkspaceTask, payload: { readonly title: string; readonly assigneeId: string; readonly dueAt?: string }) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
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
  readonly onOpenTaskChat: (task: WorkspaceTask) => void | Promise<void>;
  readonly onReturnForRevision: (task: WorkspaceTask, reasonCode: TaskReturnReason, reasonText: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onSubmitResult: (task: WorkspaceTask, resultText: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onAcceptResult: (task: WorkspaceTask) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
  readonly onSetEfficiencyExclusion: (task: WorkspaceTask, excluded: boolean, reasonCode?: TaskEfficiencyExclusionReason, reasonText?: string) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
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
    tasks, attachments, people, accessibleChatIds, currentUserId, focusTaskId, onCreateTask, onCreateSubtask, onChangeStatus, onUpdateTask,
    onSetParticipant, onRemoveParticipant, onAddChecklistItem, onToggleChecklistItem,
    onDeleteChecklistItem, onAddComment, onSetDependency, onRemoveDependency, onSetCycle, onOpenTaskChat,
    onCreateApprovalFromTask, onUploadAttachments, onDownloadAttachment, efficiency,
    efficiencyLoading, efficiencyError, onLoadEfficiency, onReturnForRevision,
    onSubmitResult, onAcceptResult,
    onSetEfficiencyExclusion,
  } = props;
  const [mode, setMode] = useState<TaskMode>("list");
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selectedId, updateSelectedId] = useState(focusTaskId ?? tasks[0]?.id ?? "");
  const [detailOpen, setDetailOpen] = useState(Boolean(focusTaskId));
  const setSelectedId = (id: string) => {
    if (id !== selectedId) {
      setEditing(false); setCreatingApproval(false); setCycleEditing(false); setDateError("");
      setChecklistTitle(""); setCommentBody(""); setParticipantId(""); setDependencyId("");
      setEfficiencyAction(""); setEfficiencyReasonText("");
      setResultText(""); setCreatingSubtask(false); setSubtaskTitle(""); setSubtaskDueAt("");
    }
    updateSelectedId(id); setDetailOpen(true);
  };
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
  const [cycleKind, setCycleKind] = useState<"daily" | "weekly" | "monthly" | "calendar">("monthly");
  const [cycleInterval, setCycleInterval] = useState("1");
  const [cycleNextRun, setCycleNextRun] = useState("");
  const [cycleCalendarRule, setCycleCalendarRule] = useState<"weekdays" | "month_days">("weekdays");
  const [cycleWeekdays, setCycleWeekdays] = useState<readonly number[]>([0]);
  const [cycleMonthDays, setCycleMonthDays] = useState("1");
  const [creatingApproval, setCreatingApproval] = useState(false);
  const [efficiencyAction, setEfficiencyAction] = useState<"return" | "exclude" | "include" | "">("");
  const [efficiencyReason, setEfficiencyReason] = useState<TaskReturnReason | TaskEfficiencyExclusionReason>("corrections_required");
  const [efficiencyReasonText, setEfficiencyReasonText] = useState("");
  const [approvalTitle, setApprovalTitle] = useState("");
  const [approvalAmount, setApprovalAmount] = useState("");
  const [resultText, setResultText] = useState("");
  const [creatingSubtask, setCreatingSubtask] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskAssigneeId, setSubtaskAssigneeId] = useState(currentUserId);
  const [subtaskDueAt, setSubtaskDueAt] = useState("");
  const newTaskFocusTarget = useRestoreFocusTarget();

  const visibleTasks = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("ru");
    const names = new Map(people.map((person) => [person.id, person.name]));
    return tasks.filter((task) => {
      const matchesFilter = filter === "mine" ? task.assigneeId === currentUserId
        : filter === "overdue" ? task.status === "overdue"
        : filter === "completed" ? task.status === "completed"
        : !["completed", "cancelled"].includes(task.status);
      const matchesRole = roleFilter === "all" || roleFilter === "author" && task.authorId === currentUserId
        || roleFilter === "assignee" && task.assigneeId === currentUserId
        || task.participants.some(item => item.userId === currentUserId && item.role === roleFilter);
      return matchesFilter && matchesRole && (!search || `${task.title} ${task.project} ${names.get(task.assigneeId) ?? ""} ${names.get(task.authorId) ?? ""}`.toLocaleLowerCase("ru").includes(search));
    });
  }, [currentUserId, filter, tasks, query, people, roleFilter]);

  const selectedTask = tasks.find((task) => task.id === selectedId)
    ?? visibleTasks[0];
  const currentUser = people.find((person) => person.id === currentUserId);
  const privileged = ["manager", "admin", "superadmin"].includes(currentUser?.role ?? "");
  const coAssignee = selectedTask?.participants.some((item) => item.userId === currentUserId && item.role === "co_assignee") ?? false;
  const canEdit = selectedTask !== undefined && (privileged || selectedTask.authorId === currentUserId || selectedTask.assigneeId === currentUserId || coAssignee);
  const canManageParticipants = selectedTask !== undefined && (privileged || selectedTask.authorId === currentUserId);
  const canSubmitResult = selectedTask !== undefined
    && (privileged || selectedTask.assigneeId === currentUserId || coAssignee)
    && ["new", "in_progress", "overdue"].includes(selectedTask.status);
  const canReviewResult = selectedTask !== undefined && canManageParticipants && selectedTask.status === "awaiting_review";
  const canOpenTaskChat = selectedTask !== undefined && Boolean(selectedTask.chatId) && (
    accessibleChatIds.includes(selectedTask.chatId ?? "")
    || selectedTask.authorId === currentUserId
    || selectedTask.assigneeId === currentUserId
    || selectedTask.participants.some((item) => item.userId === currentUserId)
  );
  const selectedSubtasks = selectedTask === undefined ? [] : tasks.filter((task) => task.parentTaskId === selectedTask.id);
  const selectedParent = selectedTask?.parentTaskId ? tasks.find((task) => task.id === selectedTask.parentTaskId) : undefined;
  const personById = (id: string) => people.find((person) => person.id === id);
  const canEditTask = (task: WorkspaceTask) => privileged
    || task.authorId === currentUserId
    || task.assigneeId === currentUserId
    || task.participants.some((item) => item.userId === currentUserId && item.role === "co_assignee");

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
    setCycleCalendarRule(selectedTask.cycle?.calendarRule ?? "weekdays");
    setCycleWeekdays(selectedTask.cycle?.weekdays?.length ? selectedTask.cycle.weekdays : [0]);
    setCycleMonthDays((selectedTask.cycle?.monthDays?.length ? selectedTask.cycle.monthDays : [1]).join(", "));
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
    const monthDays = [...new Set(cycleMonthDays.split(/[\s,;]+/).filter(Boolean).map(Number))]
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
      .sort((left, right) => left - right);
    if (cycleKind === "calendar"
      && (cycleCalendarRule === "weekdays" ? cycleWeekdays.length === 0 : monthDays.length === 0)) {
      setDateError("Выберите хотя бы один день календарного правила.");
      return;
    }
    if (await onSetCycle(selectedTask, {
      title: selectedTask.title, scheduleKind: cycleKind, interval,
      calendarRule: cycleKind === "calendar" ? cycleCalendarRule : null,
      weekdays: cycleKind === "calendar" && cycleCalendarRule === "weekdays" ? cycleWeekdays : [],
      monthDays: cycleKind === "calendar" && cycleCalendarRule === "month_days" ? monthDays : [],
      nextRunAt: cycleNextRun ? new Date(cycleNextRun).toISOString() : null, isEnabled: true,
    })) setCycleEditing(false);
  };

  const toggleCycle = async () => {
    if (selectedTask?.cycle === undefined || selectedTask.cycle === null) return;
    await onSetCycle(selectedTask, {
      title: selectedTask.cycle.title,
      scheduleKind: selectedTask.cycle.scheduleKind,
      interval: selectedTask.cycle.interval,
      calendarRule: selectedTask.cycle.calendarRule,
      weekdays: selectedTask.cycle.weekdays,
      monthDays: selectedTask.cycle.monthDays,
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

  const submitEfficiencyAction = async () => {
    if (selectedTask === undefined || !efficiencyAction) return;
    const needsText = efficiencyReason === "other";
    if (needsText && !efficiencyReasonText.trim()) { setDateError("Для другой причины добавьте пояснение."); return; }
    setDateError("");
    const result = efficiencyAction === "return"
      ? await onReturnForRevision(selectedTask, efficiencyReason as TaskReturnReason, efficiencyReasonText.trim())
      : await onSetEfficiencyExclusion(selectedTask, efficiencyAction === "exclude", efficiencyAction === "exclude" ? efficiencyReason as TaskEfficiencyExclusionReason : undefined, efficiencyReasonText.trim());
    if (result) { setEfficiencyAction(""); setEfficiencyReasonText(""); }
  };

  const createSubtask = async () => {
    if (selectedTask === undefined || !subtaskTitle.trim() || !subtaskAssigneeId) return;
    if (subtaskDueAt && !Number.isFinite(new Date(subtaskDueAt).getTime())) {
      setDateError("Проверьте срок подзадачи.");
      return;
    }
    const created = await onCreateSubtask(selectedTask, {
      title: subtaskTitle.trim(),
      assigneeId: subtaskAssigneeId,
      dueAt: subtaskDueAt ? new Date(subtaskDueAt).toISOString() : undefined,
    });
    if (created) {
      setSubtaskTitle(""); setSubtaskDueAt(""); setCreatingSubtask(false); setDateError("");
    }
  };

  const submitResult = async () => {
    if (selectedTask === undefined || !resultText.trim()) return;
    if (await onSubmitResult(selectedTask, resultText.trim())) setResultText("");
  };

  const acceptResult = async () => {
    if (selectedTask === undefined) return;
    await onAcceptResult(selectedTask);
  };

  return (
    <section className={`workspace-view tasks-view bp5-tasks ${mode === "efficiency" ? "efficiency-mode" : ""} ${mode === "dashboard" ? "dashboard-mode" : ""} ${detailOpen && selectedTask && !["dashboard", "efficiency"].includes(mode) ? "detail-open" : ""}`} aria-label="Задачи">
      <div className="tasks-main">
        <header className="section-toolbar">
          <div><h1>Задачи</h1><p>Карточки, команда, сроки и зависимости</p></div>
          <div className="task-toolbar-actions">
            <div className="view-switch" aria-label="Представление задач">
              {privileged ? <button className={mode === "dashboard" ? "active" : ""} aria-label="Обзор команды" aria-pressed={mode === "dashboard"} onClick={() => { setDetailOpen(false); setMode("dashboard"); if (!efficiencyLoading) void onLoadEfficiency(); }} type="button"><Board24Regular aria-hidden="true" />Обзор</button> : null}
              <button className={mode === "list" ? "active" : ""} aria-pressed={mode === "list"} onClick={() => setMode("list")} type="button">Список</button>
              <button className={mode === "kanban" ? "active" : ""} aria-pressed={mode === "kanban"} onClick={() => setMode("kanban")} type="button">Kanban</button>
              <button className={mode === "calendar" ? "active" : ""} aria-pressed={mode === "calendar"} onClick={() => setMode("calendar")} type="button">Календарь</button>
              <button className={mode === "efficiency" ? "active" : ""} aria-pressed={mode === "efficiency"} onClick={() => { setMode("efficiency"); if (efficiency === undefined && !efficiencyLoading) void onLoadEfficiency(); }} type="button">Эффективность</button>
            </div>
            {!(["dashboard", "efficiency"] as TaskMode[]).includes(mode) ? <Button {...newTaskFocusTarget} appearance="primary" icon={<Add24Regular />} onClick={() => setCreating(true)}>Новая задача</Button> : null}
          </div>
        </header>

        {!(["dashboard", "efficiency"] as TaskMode[]).includes(mode) ? <div className="task-filters" aria-label="Фильтры задач">
          {([ ["active", "Активные"], ["mine", "Мои"], ["overdue", "Просроченные"], ["completed", "Завершённые"] ] as const).map(([key, label]) => (
            <button className={filter === key ? "active" : ""} aria-pressed={filter === key} key={key} onClick={() => setFilter(key)} type="button">{label}</button>
          ))}
          <select className="task-role-filter" aria-label="Моя роль в задаче" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="all">Все роли</option><option value="author">Я постановщик</option><option value="assignee">Я исполнитель</option><option value="co_assignee">Я соисполнитель</option><option value="observer">Я наблюдатель</option></select>
          <Input className="task-search" aria-label="Поиск задач" contentBefore={<Search20Regular />} placeholder="Название, проект, исполнитель" value={query} onChange={(_, data) => setQuery(data.value)} />
        </div> : null}

        {creating ? <div className="quick-create" role="region" aria-label="Создание задачи">
          <Input autoFocus aria-label="Название задачи" placeholder="Что нужно сделать?" value={newTitle} onChange={(_event, data) => setNewTitle(data.value)} onKeyDown={(event) => { if (event.key === "Enter") void createTask(); if (event.key === "Escape") setCreating(false); }} />
          <Button appearance="primary" onClick={() => void createTask()} disabled={!newTitle.trim()}>Создать</Button>
          <Button appearance="subtle" onClick={() => setCreating(false)}>Отмена</Button>
        </div> : null}

        {mode === "dashboard" ? <TeamDashboardView tasks={tasks} people={people} currentUserId={currentUserId} efficiency={efficiency} efficiencyLoading={efficiencyLoading} efficiencyError={efficiencyError} onSelectTask={(taskId) => { setSelectedId(taskId); setMode("list"); }} /> : mode === "efficiency" ? <EfficiencyView overview={efficiency} loading={efficiencyLoading} error={efficiencyError} onPeriodChange={onLoadEfficiency} /> : mode === "list" ? <TaskRecords tasks={visibleTasks} people={people} selectedId={detailOpen ? selectedTask?.id : undefined} filterKey={`${filter}:${query}:${roleFilter}`} onSelect={setSelectedId} /> : mode === "calendar" ? <TaskCalendarView tasks={visibleTasks} onSelect={setSelectedId} /> : (
          <div className="task-kanban" aria-label="Kanban задач">
            {kanbanStatuses.map((status) => {
              const columnTasks = visibleTasks.filter((task) => task.status === status);
              const acceptsDrop = ["new", "in_progress"].includes(status);
              return <section className="kanban-column" data-task-status={status} key={status} onDragOver={(event) => { if (acceptsDrop) event.preventDefault(); }} onDrop={(event) => { if (!acceptsDrop) return; const taskId = event.dataTransfer.getData("text/task-id"); if (taskId) void onChangeStatus(taskId, status); }}>
                <header><strong>{statusLabels[status]}</strong><Badge appearance="filled">{columnTasks.length}</Badge></header>
                <div className="kanban-stack" tabIndex={0} aria-label={`${statusLabels[status]}: задачи`}>
                  {columnTasks.map((task) => { const draggable = canEditTask(task) && !["awaiting_review", "completed", "cancelled"].includes(task.status); return <button {...newTaskFocusTarget} className={`kanban-card ${selectedTask?.id === task.id ? "selected" : ""}`} draggable={draggable} key={task.id} onClick={() => setSelectedId(task.id)} onDragStart={(event) => { if (draggable) event.dataTransfer.setData("text/task-id", task.id); }} type="button"><strong>{task.title}</strong>{task.parentTaskId ? <span className="subtask-marker">Подзадача</span> : null}<span>{task.project}</span><small>{task.dueLabel}</small><ProgressBar aria-label={`Чек-лист: ${task.title}`} value={task.checklistTotal ? task.checklistDone / task.checklistTotal : 0} /></button>; })}
                </div>
              </section>;
            })}
          </div>
        )}
      </div>

      {!(["dashboard", "efficiency"] as TaskMode[]).includes(mode) && selectedTask !== undefined ? <Dialog open={detailOpen} onOpenChange={(_, data) => { if (!data.open) setDetailOpen(false); }}>
      <DialogSurface className="task-record-dialog" aria-label={selectedTask.title}><aside className="task-detail task-card-full">
        <Button className="compact-back" appearance="subtle" onClick={() => setDetailOpen(false)}>К списку задач</Button>
        {dateError ? <div className="auth-error" role="alert">{dateError}</div> : null}
        <div className="task-detail-heading"><div><div className="detail-kicker">{selectedTask.project}</div><h2>{selectedTask.title}</h2></div>{canEdit ? <Button appearance="subtle" icon={<Edit24Regular />} onClick={startEditing}>Редактировать карточку</Button> : null}</div>
        {selectedTask.sourceMessageId ? <div className="source-link-note">Создана из сообщения · связь сохранена</div> : null}
        <div className="detail-meta"><div><Avatar name={personById(selectedTask.assigneeId)?.name ?? "Сотрудник"} size={36} color="colorful" /><span><small>Ответственный</small><strong>{personById(selectedTask.assigneeId)?.name ?? "Сотрудник"}</strong></span></div><div><Calendar24Regular /><span><small>Срок</small><strong>{selectedTask.dueLabel}</strong></span></div></div>
        <div className="task-lifecycle-summary"><span>Статус</span><Badge appearance="tint" color={selectedTask.status === "completed" ? "success" : selectedTask.status === "overdue" ? "danger" : selectedTask.status === "awaiting_review" ? "warning" : "informative"}>{statusLabels[selectedTask.status]}</Badge>{canEdit && selectedTask.status === "new" ? <Button appearance="subtle" onClick={() => void onChangeStatus(selectedTask.id, "in_progress")}>Начать работу</Button> : canManageParticipants && ["in_progress", "overdue"].includes(selectedTask.status) ? <Button appearance="subtle" onClick={() => void onChangeStatus(selectedTask.id, "cancelled")}>Отменить задачу</Button> : null}</div>
        {selectedTask.parentTaskId ? <div className="task-parent-link"><span>Подзадача для</span><button type="button" disabled={!selectedParent} onClick={() => { if (selectedParent) setSelectedId(selectedParent.id); }}>{selectedTask.parentTaskTitle ?? selectedParent?.title ?? "родительской задачи"}</button></div> : null}

        {editing ? <div className="task-card-editor" aria-label="Редактирование карточки задачи">
          <Input aria-label="Название в карточке" value={editTitle} onChange={(_event, data) => setEditTitle(data.value)} />
          <Textarea aria-label="Описание задачи" value={editDescription} onChange={(_event, data) => setEditDescription(data.value)} />
          <Input aria-label="Проект задачи" value={editProject} onChange={(_event, data) => setEditProject(data.value)} />
          <label><span>Ответственный</span><select aria-label="Ответственный задачи" value={editAssigneeId} onChange={(event) => setEditAssigneeId(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span>Приоритет</span><select aria-label="Приоритет задачи" value={editPriority} onChange={(event) => setEditPriority(event.target.value as WorkspaceTask["priority"])}><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option></select></label>
          <label><span>Срок</span><input aria-label="Срок задачи" type="datetime-local" value={editDueAt} onChange={(event) => setEditDueAt(event.target.value)} /></label>
          <div className="task-editor-actions"><Button appearance="primary" onClick={() => void saveTask()}>Сохранить карточку</Button><Button appearance="subtle" onClick={() => setEditing(false)}>Отмена</Button></div>
        </div> : <div className="detail-section"><h3>Описание</h3><p>{selectedTask.description || "Описание пока не добавлено."}</p></div>}

        <div className={`detail-section task-review-section status-${selectedTask.status}`}><div className="detail-section-line"><h3>Результат и проверка</h3><span>{reviewStatusLabel(selectedTask.status)}</span></div>
          {selectedTask.latestReturn && selectedTask.status !== "completed" ? <div className="task-return-note"><strong>{returnReasonLabels[selectedTask.latestReturn.reasonCode] ?? "Возвращено на доработку"}</strong>{selectedTask.latestReturn.reasonText ? <p>{selectedTask.latestReturn.reasonText}</p> : null}<small>{new Date(selectedTask.latestReturn.createdAt).toLocaleString("ru-RU")}</small></div> : null}
          {selectedTask.resultText ? <div className="task-submitted-result"><small>Переданный результат</small><p>{selectedTask.resultText}</p></div> : null}
          {canSubmitResult ? <div className="task-result-composer"><Textarea aria-label="Результат задачи" placeholder="Опишите выполненную работу и добавьте всё, что нужно проверить" value={resultText} onChange={(_, data) => setResultText(data.value)} /><Button appearance="primary" onClick={() => void submitResult()} disabled={!resultText.trim()}>Отправить на проверку</Button><small>После отправки постановщик примет результат или вернёт его с причиной.</small></div> : null}
          {canReviewResult ? <div className="task-review-actions"><Button appearance="primary" onClick={() => void acceptResult()}>Принять результат</Button><Button appearance="secondary" onClick={() => { setEfficiencyAction("return"); setEfficiencyReason("corrections_required"); }}>Вернуть на доработку</Button></div> : null}
          {efficiencyAction === "return" ? <div className="task-card-editor efficiency-action-form" role="region" aria-label="Мотивированный возврат"><label><span>Причина возврата</span><select aria-label="Причина действия эффективности" value={efficiencyReason} onChange={(event) => setEfficiencyReason(event.target.value as typeof efficiencyReason)}><option value="corrections_required">Нужны исправления</option><option value="incomplete_result">Результат неполный</option><option value="requirements_not_met">Требования не выполнены</option><option value="other">Другая причина</option></select></label><Textarea aria-label="Пояснение причины" placeholder={efficiencyReason === "other" ? "Обязательное пояснение" : "Что именно нужно исправить"} value={efficiencyReasonText} onChange={(_, data) => setEfficiencyReasonText(data.value)} /><div className="task-editor-actions"><Button appearance="primary" onClick={() => void submitEfficiencyAction()}>Вернуть исполнителю</Button><Button appearance="subtle" onClick={() => setEfficiencyAction("")}>Отмена</Button></div></div> : null}
        </div>

        <div className="detail-section task-participants-section"><div className="detail-section-line"><h3>Участники</h3><span>{selectedTask.participants.length + 1}</span></div><div className="participant-list">
          <ParticipantChip person={personById(selectedTask.assigneeId)} label="Ответственный" />
          {selectedTask.participants.map((participant) => <ParticipantChip key={`${participant.userId}-${participant.role}`} person={personById(participant.userId)} label={participant.role === "co_assignee" ? "Соисполнитель" : "Наблюдатель"} onRemove={canManageParticipants ? () => void onRemoveParticipant(selectedTask, participant.userId) : undefined} />)}
        </div>{canManageParticipants ? <div className="inline-task-form"><select aria-label="Новый участник" value={participantId} onChange={(event) => setParticipantId(event.target.value)}><option value="">Выберите сотрудника</option>{people.filter((person) => person.id !== selectedTask.assigneeId && !selectedTask.participants.some((item) => item.userId === person.id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><select aria-label="Роль участника" value={participantRole} onChange={(event) => setParticipantRole(event.target.value as TaskParticipantRole)}><option value="co_assignee">Соисполнитель</option><option value="observer">Наблюдатель</option></select><Button appearance="secondary" onClick={() => void addParticipant()} disabled={!participantId}>Добавить</Button></div> : null}</div>

        <AttachmentPanel attachments={attachments.filter((attachment) => attachment.ownerType === "task" && attachment.ownerId === selectedTask.id)} canUpload={canEdit} onUpload={(files) => onUploadAttachments(selectedTask, files)} onDownload={onDownloadAttachment} />

        <div className="detail-section task-subtasks-section"><div className="detail-section-line"><h3>Подзадачи</h3><span>{selectedSubtasks.filter((task) => task.status === "completed").length}/{selectedSubtasks.length}</span></div>
          <div className="task-subtask-list">{selectedSubtasks.map((task) => <button type="button" className="task-subtask-row" key={task.id} onClick={() => setSelectedId(task.id)}><span><strong>{task.title}</strong><small>{personById(task.assigneeId)?.name ?? "Сотрудник"} · {task.dueLabel}</small></span><Badge appearance="tint" color={task.status === "completed" ? "success" : task.status === "overdue" ? "danger" : "informative"}>{statusLabels[task.status]}</Badge></button>)}</div>
          {canEdit && selectedTask.status !== "completed" && selectedTask.status !== "cancelled" ? creatingSubtask ? <div className="task-card-editor subtask-create-form" role="region" aria-label="Новая подзадача"><Input autoFocus aria-label="Название подзадачи" placeholder="Что нужно сделать?" value={subtaskTitle} onChange={(_, data) => setSubtaskTitle(data.value)} /><label><span>Исполнитель</span><select aria-label="Исполнитель подзадачи" value={subtaskAssigneeId} onChange={(event) => setSubtaskAssigneeId(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>Срок</span><input aria-label="Срок подзадачи" type="datetime-local" value={subtaskDueAt} onChange={(event) => setSubtaskDueAt(event.target.value)} /></label><div className="task-editor-actions"><Button appearance="primary" onClick={() => void createSubtask()} disabled={!subtaskTitle.trim()}>Создать подзадачу</Button><Button appearance="subtle" onClick={() => setCreatingSubtask(false)}>Отмена</Button></div></div> : <Button appearance="subtle" icon={<Add24Regular />} onClick={() => { setSubtaskAssigneeId(selectedTask.assigneeId); setCreatingSubtask(true); }}>Добавить подзадачу</Button> : null}
        </div>

        <div className="detail-section task-checklist-section"><div className="detail-section-line"><h3>Чек-лист</h3><span>{selectedTask.checklistDone}/{selectedTask.checklistTotal}</span></div><ProgressBar aria-label="Выполнено пунктов чек-листа" value={selectedTask.checklistTotal ? selectedTask.checklistDone / selectedTask.checklistTotal : 0} /><div className="checklist-items">{selectedTask.checklist.map((item) => <div className="checklist-row" key={item.id}><Checkbox checked={item.isCompleted} disabled={!canEdit} label={item.title} onChange={(_event, data) => void onToggleChecklistItem(selectedTask, item.id, data.checked === true)} />{canEdit ? <button aria-label={`Удалить пункт ${item.title}`} onClick={() => void onDeleteChecklistItem(selectedTask, item.id)} type="button"><Delete24Regular /></button> : null}</div>)}</div>{canEdit ? <div className="inline-task-form"><Input aria-label="Новый пункт чек-листа" placeholder="Добавить пункт" value={checklistTitle} onChange={(_event, data) => setChecklistTitle(data.value)} /><Button appearance="secondary" onClick={() => void addChecklistItem()} disabled={!checklistTitle.trim()}>Добавить</Button></div> : null}</div>

        <div className="detail-section task-dependencies-section"><div className="detail-section-line"><h3>Зависимости</h3><span>{selectedTask.dependencies.length}</span></div>{selectedTask.dependencies.map((dependency) => <div className="dependency-row" key={dependency.dependsOnTaskId}><span><strong>{dependency.title}</strong><small>{dependency.dependencyKind === "blocks" ? "Блокирует выполнение" : "Связанная задача"}</small></span><Badge appearance="tint" color={dependency.status === "completed" ? "success" : "warning"}>{statusLabels[dependency.status]}</Badge>{canEdit ? <button aria-label={`Убрать зависимость ${dependency.title}`} onClick={() => void onRemoveDependency(selectedTask, dependency.dependsOnTaskId)} type="button">×</button> : null}</div>)}{canEdit ? <div className="inline-task-form"><select aria-label="Зависимая задача" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}><option value="">Выберите задачу</option>{tasks.filter((task) => task.id !== selectedTask.id && !selectedTask.dependencies.some((item) => item.dependsOnTaskId === task.id)).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><select aria-label="Тип зависимости" value={dependencyKind} onChange={(event) => setDependencyKind(event.target.value as "blocks" | "relates")}><option value="blocks">Блокирует</option><option value="relates">Связана</option></select><Button appearance="secondary" onClick={() => void addDependency()} disabled={!dependencyId}>Связать</Button></div> : null}</div>

        <div className="detail-section task-cycle-section">
          <div className="detail-section-line">
            <h3>Повторение</h3>
            {canEdit ? <span className="cycle-actions"><Button appearance="subtle" onClick={startCycleEditing}>{selectedTask.cycle ? "Настроить" : "Добавить цикл"}</Button>{selectedTask.cycle ? <Button appearance="subtle" onClick={() => void toggleCycle()}>{selectedTask.cycle.isEnabled ? "Отключить" : "Включить"}</Button> : null}</span> : null}
          </div>
          {selectedTask.cycle ? <div className={`cycle-summary ${selectedTask.cycle.isEnabled ? "" : "disabled"}`}><span><strong>{selectedTask.cycle.isEnabled ? "" : "Отключено · "}{cycleLabel(selectedTask.cycle)}</strong><small>Следующая задача: {selectedTask.cycle.nextRunAt ? new Date(selectedTask.cycle.nextRunAt).toLocaleString("ru-RU") : "не запланирована"}</small></span></div> : <p>Задача не повторяется.</p>}
          {cycleEditing ? <div className="cycle-form">
            <div className="cycle-form-main">
              <label><span>Правило</span><select aria-label="Период повторения" value={cycleKind} onChange={(event) => setCycleKind(event.target.value as typeof cycleKind)}><option value="daily">Каждые несколько дней</option><option value="weekly">Каждые несколько недель</option><option value="monthly">Каждые несколько месяцев</option><option value="calendar">Выбранные дни календаря</option></select></label>
              {cycleKind !== "calendar" ? <label><span>Интервал</span><Input aria-label="Интервал повторения" type="number" min={1} value={cycleInterval} onChange={(_event, data) => setCycleInterval(data.value)} /></label> : null}
              <label><span>Время ближайшего запуска</span><input aria-label="Следующее повторение" type="datetime-local" value={cycleNextRun} onChange={(event) => setCycleNextRun(event.target.value)} /></label>
            </div>
            {cycleKind === "calendar" ? <fieldset className="cycle-calendar-rule"><legend>Календарное правило</legend><select aria-label="Тип календарного правила" value={cycleCalendarRule} onChange={(event) => setCycleCalendarRule(event.target.value as typeof cycleCalendarRule)}><option value="weekdays">Дни недели</option><option value="month_days">Числа месяца</option></select>{cycleCalendarRule === "weekdays" ? <div className="cycle-weekday-picker">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label, day) => <label key={label}><input type="checkbox" checked={cycleWeekdays.includes(day)} onChange={() => setCycleWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort())} /><span>{label}</span></label>)}</div> : <label className="cycle-month-days"><span>Числа через запятую</span><Input aria-label="Числа месяца" placeholder="Например: 1, 10, 25" value={cycleMonthDays} onChange={(_event, data) => setCycleMonthDays(data.value)} /></label>}</fieldset> : null}
            <div className="task-editor-actions"><Button appearance="primary" onClick={() => void saveCycle()}>Сохранить цикл</Button><Button appearance="subtle" onClick={() => setCycleEditing(false)}>Отмена</Button></div>
          </div> : null}
        </div>

        <div className="detail-section task-comments-section"><div className="detail-section-line"><h3>Комментарии</h3><span>{selectedTask.comments.length}</span></div><div className="task-comment-list">{selectedTask.comments.map((comment) => <div className="task-comment" key={comment.id}><Avatar name={personById(comment.authorUserId)?.name ?? ""} size={28} /><span><strong>{personById(comment.authorUserId)?.name}</strong><small>{new Date(comment.createdAt).toLocaleString("ru-RU")}</small><p>{comment.body}</p></span></div>)}</div><div className="task-comment-composer"><Textarea aria-label="Новый комментарий" placeholder="Написать комментарий" value={commentBody} onChange={(_event, data) => setCommentBody(data.value)} /><Button appearance="primary" onClick={() => void addComment()} disabled={!commentBody.trim()}>Отправить</Button></div></div>

        <div className="detail-section task-efficiency-actions"><div className="detail-section-line"><h3>Учёт сроков</h3><span>EFF-1.0</span></div><p>Мотивированный возврат фиксируется в истории отдельно и не уменьшает процент выполнения в срок.</p>{canManageParticipants ? <div className="task-editor-actions"><Button appearance="subtle" onClick={() => { setEfficiencyAction("exclude"); setEfficiencyReason("external_dependency"); }}>Исключить по причине</Button><Button appearance="subtle" onClick={() => setEfficiencyAction("include")}>Вернуть в расчёт</Button></div> : null}
        {efficiencyAction && efficiencyAction !== "return" ? <div className="task-card-editor efficiency-action-form" role="region" aria-label={efficiencyAction === "exclude" ? "Исключение из расчёта" : "Возврат в расчёт"}>{efficiencyAction !== "include" ? <label><span>Причина</span><select aria-label="Причина действия эффективности" value={efficiencyReason} onChange={(event) => setEfficiencyReason(event.target.value as typeof efficiencyReason)}><option value="external_dependency">Внешняя зависимость</option><option value="requirements_changed">Требования изменились</option><option value="cancelled">Задача отменена</option><option value="duplicate">Дубликат</option><option value="other">Другая причина</option></select></label> : <p>Задача снова будет учитываться по зафиксированным срокам и событиям.</p>}{efficiencyAction !== "include" ? <Textarea aria-label="Пояснение причины" placeholder={efficiencyReason === "other" ? "Обязательное пояснение" : "Дополнительное пояснение"} value={efficiencyReasonText} onChange={(_, data) => setEfficiencyReasonText(data.value)} /> : null}<div className="task-editor-actions"><Button appearance="primary" onClick={() => void submitEfficiencyAction()}>Подтвердить</Button><Button appearance="subtle" onClick={() => setEfficiencyAction("")}>Отмена</Button></div></div> : null}</div>
        <div className="detail-footer">
          <Button appearance="primary" icon={<Chat24Regular />} disabled={!canOpenTaskChat} title={canOpenTaskChat ? "Перейти в связанный чат" : "Чат доступен участникам задачи"} onClick={() => void onOpenTaskChat(selectedTask)}>Открыть чат задачи</Button>
          <Button appearance="secondary" icon={<Money24Regular />} onClick={startApproval}>Создать заявку на оплату</Button>
        </div>
        {creatingApproval ? <div className="linked-create-panel task-approval-create" role="region" aria-label="Заявка из задачи"><Money24Regular /><Input aria-label="Название заявки из задачи" value={approvalTitle} onChange={(_event, data) => setApprovalTitle(data.value)} /><Input aria-label="Сумма заявки из задачи" inputMode="numeric" placeholder="Сумма в UZS" value={approvalAmount} onChange={(_event, data) => setApprovalAmount(data.value)} /><Button appearance="primary" onClick={() => void createApproval()}>Отправить по маршруту</Button><Button appearance="subtle" onClick={() => setCreatingApproval(false)}>Отмена</Button></div> : null}
      </aside></DialogSurface>
      </Dialog> : null}
    </section>
  );
}

function ParticipantChip({ person, label, onRemove }: {
  readonly person?: WorkspacePerson;
  readonly label: string;
  readonly onRemove?: () => void;
}) {
  return <div className="participant-chip"><Avatar name={person?.name ?? "Сотрудник"} size={24} /><span>{person?.name ?? "Сотрудник"}<small>{label}</small></span>{onRemove ? <button aria-label={`Убрать участника ${person?.name ?? ""}`} onClick={onRemove} type="button">×</button> : null}</div>;
}
