import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type {
  EfficiencyOverview,
  WorkspacePerson,
  WorkspaceTask,
} from "@yuksalish/contracts";
import { Avatar, Button } from "@fluentui/react-components";
import {
  ArrowRight20Regular,
  ArrowLeft20Regular,
  CalendarClock24Regular,
  CheckmarkCircle24Regular,
  Clock24Regular,
  Dismiss24Regular,
  PeopleTeam24Regular,
  Sparkle24Regular,
  Warning24Regular,
} from "@fluentui/react-icons";

import { TeamPresencePanel } from "./TeamPresencePanel";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

interface TeamDashboardViewProps {
  readonly token: string;
  readonly tasks: readonly WorkspaceTask[];
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly efficiency?: EfficiencyOverview;
  readonly efficiencyLoading: boolean;
  readonly efficiencyError?: string;
  readonly onSelectTask: (taskId: string) => void;
}

type TeamFilter = "all" | "risk" | "review";
type AttentionTone = "danger" | "review" | "today" | "priority" | "soon";
type FlowStatusKey = "new" | "progress" | "review" | "overdue";
type FlowSelection =
  | { readonly kind: "status"; readonly key: FlowStatusKey; readonly label: string }
  | { readonly kind: "day"; readonly date: Date; readonly label: string };

const activeStatuses = new Set<WorkspaceTask["status"]>([
  "new",
  "in_progress",
  "awaiting_review",
  "overdue",
]);

const shortDayFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric" });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const timeFormatter = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fullDayFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });

const taskStatusLabels: Readonly<Record<WorkspaceTask["status"], string>> = {
  new: "Новая",
  in_progress: "В работе",
  awaiting_review: "На проверке",
  completed: "Завершена",
  overdue: "Просрочена",
  cancelled: "Отменена",
};

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function validDueDate(task: WorkspaceTask): Date | undefined {
  if (!task.dueAt) return undefined;
  const date = new Date(task.dueAt);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function isTaskOverdue(task: WorkspaceTask, now: Date): boolean {
  if (!activeStatuses.has(task.status)) return false;
  const due = validDueDate(task);
  return task.status === "overdue" || Boolean(due && due.getTime() < now.getTime());
}

function pluralForm(value: number, forms: readonly [string, string, string]): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  return mod100 >= 11 && mod100 <= 14
    ? forms[2]
    : mod10 === 1
      ? forms[0]
      : mod10 >= 2 && mod10 <= 4
        ? forms[1]
        : forms[2];
}

function plural(value: number, forms: readonly [string, string, string]): string {
  return `${value.toLocaleString("ru-RU")} ${pluralForm(value, forms)}`;
}

function overdueLabel(task: WorkspaceTask, now: Date): string {
  const due = validDueDate(task);
  if (!due) return "Отмечена как просроченная";
  const days = Math.max(1, Math.ceil((startOfDay(now).getTime() - startOfDay(due).getTime()) / 86_400_000));
  return `Просрочена на ${plural(days, ["день", "дня", "дней"])}`;
}

function taskAttention(task: WorkspaceTask, now: Date): { readonly score: number; readonly tone: AttentionTone; readonly label: string } | undefined {
  if (!activeStatuses.has(task.status)) return undefined;
  const due = validDueDate(task);
  const todayEnd = endOfDay(now);
  const weekEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  if (isTaskOverdue(task, now)) return { score: 1_000 + (task.priority === "urgent" ? 80 : 0), tone: "danger", label: overdueLabel(task, now) };
  if (task.status === "awaiting_review") return { score: 900, tone: "review", label: "Ожидает решения постановщика" };
  if (due && due <= todayEnd) return { score: 800, tone: "today", label: `Срок сегодня в ${timeFormatter.format(due)}` };
  if (task.priority === "urgent") return { score: 700, tone: "priority", label: "Срочный приоритет" };
  if (task.priority === "high") return { score: 600, tone: "priority", label: "Высокий приоритет" };
  if (due && due <= weekEnd) return { score: 500 - Math.floor((due.getTime() - now.getTime()) / 86_400_000), tone: "soon", label: `Срок ${dateFormatter.format(due)}` };
  return undefined;
}

function MetricCard({ icon, label, value, note, tone, active, onSelect }: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: number;
  readonly note: string;
  readonly tone: "brand" | "danger" | "review" | "calm";
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  return <button type="button" onClick={onSelect} aria-pressed={active} className={`team-dash-metric tone-${tone}`}>
    <div className="team-dash-metric-icon" aria-hidden="true">{icon}</div>
    <div><span>{label}</span><strong>{value.toLocaleString("ru-RU")}</strong><small>{note}</small></div>
  </button>;
}

export function TeamDashboardView({
  token,
  tasks,
  people,
  currentUserId,
  efficiency,
  efficiencyLoading,
  efficiencyError,
  onSelectTask,
}: TeamDashboardViewProps) {
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [selectedPersonId, setSelectedPersonId] = useState<string>();
  const [attentionFilter, setAttentionFilter] = useState<"all" | "overdue" | "review" | "today">("all");
  const [flowSelection, setFlowSelection] = useState<FlowSelection>();
  const [drawerTaskId, setDrawerTaskId] = useState<string>();
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const currentUser = people.find((person) => person.id === currentUserId);
  const activeTasks = tasks.filter((task) => activeStatuses.has(task.status));
  const overdueTasks = activeTasks.filter((task) => isTaskOverdue(task, now));
  const reviewTasks = activeTasks.filter((task) => task.status === "awaiting_review");
  const dueToday = activeTasks.filter((task) => {
    const due = validDueDate(task);
    return Boolean(due && due >= todayStart && due <= todayEnd && !isTaskOverdue(task, now));
  });
  const dueThisWeek = activeTasks.filter((task) => {
    const due = validDueDate(task);
    return Boolean(due && due > now && due <= weekEnd);
  });
  const efficiencyByUser = new Map(efficiency?.employees.map((employee) => [employee.userId, employee]));
  const personById = new Map(people.map((person) => [person.id, person]));

  const attentionTasks = tasks
    .map((task) => ({ task, attention: taskAttention(task, now) }))
    .filter((item): item is { task: WorkspaceTask; attention: NonNullable<ReturnType<typeof taskAttention>> } => item.attention !== undefined)
    .filter((item) => !selectedPersonId || item.task.assigneeId === selectedPersonId)
    .filter(({ task }) => attentionFilter === "all" || attentionFilter === "overdue" && isTaskOverdue(task, now) || attentionFilter === "review" && task.status === "awaiting_review" || attentionFilter === "today" && dueToday.some(item => item.id === task.id))
    .sort((left, right) => right.attention.score - left.attention.score)
    .slice(0, 8);

  const teamRows = (() => {
    const rows = people.map((person) => {
      const assigned = activeTasks.filter((task) => task.assigneeId === person.id);
      const overdue = assigned.filter((task) => isTaskOverdue(task, now)).length;
      const review = assigned.filter((task) => task.status === "awaiting_review").length;
      const soon = assigned.filter((task) => {
        const due = validDueDate(task);
        return Boolean(due && due > now && due <= weekEnd);
      }).length;
      return { person, active: assigned.length, overdue, review, soon, efficiency: efficiencyByUser.get(person.id) };
    });
    return rows
      .filter((row) => teamFilter === "all" || teamFilter === "risk" && row.overdue > 0 || teamFilter === "review" && row.review > 0)
      .sort((left, right) => right.overdue - left.overdue || right.review - left.review || right.active - left.active || left.person.name.localeCompare(right.person.name, "ru"));
  })();

  const maximumActive = Math.max(1, ...teamRows.map((row) => row.active));
  const horizon = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + offset);
    const dayEnd = endOfDay(date);
    const count = activeTasks.filter((task) => {
      const due = validDueDate(task);
      return Boolean(due && due >= date && due <= dayEnd && !isTaskOverdue(task, now));
    }).length;
    return { date, count };
  });
  const maximumDayCount = Math.max(1, ...horizon.map((day) => day.count));
  const flowParts: readonly { readonly key: FlowStatusKey; readonly label: string; readonly value: number }[] = [
    { key: "new", label: "Новые", value: activeTasks.filter((task) => task.status === "new" && !isTaskOverdue(task, now)).length },
    { key: "progress", label: "В работе", value: activeTasks.filter((task) => task.status === "in_progress" && !isTaskOverdue(task, now)).length },
    { key: "review", label: "На проверке", value: reviewTasks.filter(task => !isTaskOverdue(task, now)).length },
    { key: "overdue", label: "Просрочены", value: overdueTasks.length },
  ];
  const firstName = currentUser?.name.split(" ")[0] ?? "руководитель";
  const flowSelectionTasks = flowSelection?.kind === "status"
    ? activeTasks.filter((task) => {
      if (flowSelection.key === "overdue") return isTaskOverdue(task, now);
      if (isTaskOverdue(task, now)) return false;
      if (flowSelection.key === "new") return task.status === "new";
      if (flowSelection.key === "progress") return task.status === "in_progress";
      return task.status === "awaiting_review";
    })
    : flowSelection?.kind === "day"
      ? activeTasks.filter((task) => {
        const due = validDueDate(task);
        return Boolean(
          due
          && due >= startOfDay(flowSelection.date)
          && due <= endOfDay(flowSelection.date)
          && !isTaskOverdue(task, now),
        );
      })
      : [];
  const sortedFlowSelectionTasks = [...flowSelectionTasks].sort((left, right) => {
    const leftDue = validDueDate(left)?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDue = validDueDate(right)?.getTime() ?? Number.POSITIVE_INFINITY;
    return leftDue - rightDue || left.title.localeCompare(right.title, "ru");
  });
  const drawerTask = sortedFlowSelectionTasks.find((task) => task.id === drawerTaskId);

  const selectFlow = (selection: FlowSelection) => {
    setFlowSelection(selection);
    setDrawerTaskId(undefined);
  };

  useEffect(() => {
    if (!flowSelection) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFlowSelection(undefined);
        setDrawerTaskId(undefined);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [flowSelection]);

  return <div className="team-dashboard">
    <section className="team-dash-hero" aria-labelledby="team-dashboard-title">
      <div className="team-dash-hero-copy">
        <span>Обзор команды · сегодня</span>
        <h2 id="team-dashboard-title">Добрый день, {firstName}</h2>
        <p>{overdueTasks.length || reviewTasks.length
          ? `В фокусе ${plural(overdueTasks.length + reviewTasks.length, ["задача", "задачи", "задач"])}: просрочки и результаты, ожидающие решения.`
          : "Срочных блокеров нет. Можно сосредоточиться на задачах ближайших семи дней."}</p>
      </div>
      <div className="team-dash-hero-summary" aria-label="Краткая сводка команды">
        <PeopleTeam24Regular aria-hidden="true" />
        <div><strong>{people.length}</strong><span>сотрудников в обзоре</span></div>
      </div>
    </section>

    {["manager", "admin", "superadmin"].includes(currentUser?.role ?? "")
      ? <TeamPresencePanel token={token} /> : null}

    <div className="team-focus-strip" role="group" aria-label="Фокус на сотруднике">
      <button type="button" aria-pressed={!selectedPersonId} className="team-focus-all" onClick={() => setSelectedPersonId(undefined)}><PeopleTeam24Regular /><span>Вся команда</span></button>
      {people.map(person => <button key={person.id} type="button" className="team-focus-person" aria-pressed={selectedPersonId === person.id} onClick={() => setSelectedPersonId(current => current === person.id ? undefined : person.id)} title={person.jobTitle ?? person.name}><EmployeeProfileLink userId={person.id} personName={person.name}><Avatar size={36} name={person.name} color="colorful" /><span>{person.name}</span></EmployeeProfileLink></button>)}
    </div>

    <section className="team-dash-metrics" aria-label="Ключевые показатели команды">
      <MetricCard active={attentionFilter === "all"} onSelect={() => setAttentionFilter("all")} icon={<Sparkle24Regular />} label="Активные задачи" value={activeTasks.length} note={`${dueThisWeek.length} со сроком в ближайшие 7 дней`} tone="brand" />
      <MetricCard active={attentionFilter === "overdue"} onSelect={() => setAttentionFilter("overdue")} icon={<Warning24Regular />} label="Нужна помощь" value={overdueTasks.length} note={overdueTasks.length ? "просроченные задачи" : "просрочек нет"} tone="danger" />
      <MetricCard active={attentionFilter === "review"} onSelect={() => setAttentionFilter("review")} icon={<CheckmarkCircle24Regular />} label="Ждут решения" value={reviewTasks.length} note="результаты на проверке" tone="review" />
      <MetricCard active={attentionFilter === "today"} onSelect={() => setAttentionFilter("today")} icon={<CalendarClock24Regular />} label="Срок сегодня" value={dueToday.length} note={dueToday.length ? "дедлайны до конца дня" : "сегодня без дедлайнов"} tone="calm" />
    </section>

    <div className="team-dash-main-grid">
      <section className="team-dash-panel team-dash-attention" aria-labelledby="attention-title">
        <header className="team-dash-panel-heading">
          <div><span>Следующее действие</span><h3 id="attention-title">Требует внимания</h3></div>
          {selectedPersonId ? <Button appearance="subtle" onClick={() => setSelectedPersonId(undefined)}>Показать всю команду</Button> : <small>сначала самое срочное</small>}
        </header>
        <div className="team-dash-attention-list">
          {attentionTasks.map(({ task, attention }) => {
            const assignee = personById.get(task.assigneeId);
            return <button className={`team-dash-task tone-${attention.tone}`} key={task.id} type="button" onClick={() => onSelectTask(task.id)}>
              <span className="team-dash-task-signal" aria-hidden="true" />
              <span className="team-dash-task-copy"><strong>{task.title}</strong><small>{task.project} · {attention.label}</small></span>
              <EmployeeProfileLink userId={assignee?.id} personName={assignee?.name ?? "Сотрудник"} className="team-dash-task-person"><Avatar name={assignee?.name ?? "Сотрудник"} size={28} /><span>{assignee?.name ?? "Сотрудник"}</span></EmployeeProfileLink>
              <ArrowRight20Regular aria-hidden="true" />
            </button>;
          })}
          {!attentionTasks.length ? <div className="team-dash-empty"><CheckmarkCircle24Regular /><div><strong>Всё спокойно</strong><span>{selectedPersonId ? "У сотрудника нет срочных задач." : "Просрочек, срочных сроков и результатов на проверке сейчас нет."}</span></div></div> : null}
        </div>
      </section>

      <aside className="team-dash-panel team-dash-flow" aria-labelledby="flow-title">
        <header className="team-dash-panel-heading team-dash-flow-heading">
          <div><span>Состояние потока</span><h3 id="flow-title">Работа команды</h3></div>
          <div className="team-dash-flow-total" aria-label={plural(activeTasks.length, ["активная задача", "активные задачи", "активных задач"])}>
            <strong>{activeTasks.length}</strong>
            <span>{activeTasks.length === 1 ? "активная задача" : "активных задач"}</span>
          </div>
        </header>
        <div className="team-dash-flow-overview">
          <div className={`team-dash-flow-bar ${activeTasks.length ? "" : "is-empty"}`} aria-label={`Всего активных задач: ${activeTasks.length}`}>
            {flowParts.filter((part) => part.value > 0).map((part) => <i className={`part-${part.key}`} key={part.key} style={{ flexGrow: part.value }} />)}
          </div>
          <div className="team-dash-flow-legend" role="group" aria-label="Задачи по статусам">
            {flowParts.map((part) => <button
              type="button"
              className={`flow-${part.key}`}
              aria-pressed={flowSelection?.kind === "status" && flowSelection.key === part.key}
              key={part.key}
              onClick={() => selectFlow({ kind: "status", key: part.key, label: part.label })}
            ><span><i className={`part-${part.key}`} />{part.label}</span><strong>{part.value}</strong></button>)}
          </div>
        </div>
        <div className={`team-dash-week ${dueThisWeek.length ? "" : "is-empty"}`}>
          <div className="team-dash-week-heading">
            <Clock24Regular />
            <span><strong>Ближайшие 7 дней</strong><small>задачи по сроку</small></span>
            <b>{dueThisWeek.length}</b>
          </div>
          {!dueThisWeek.length ? <p className="team-dash-week-empty">Неделя без запланированных дедлайнов</p> : null}
          <div className="team-dash-week-bars">
            {horizon.map((day, index) => <button
              type="button"
              key={day.date.toISOString()}
              className={index === 0 ? "is-today" : ""}
              aria-label={`Задачи со сроком ${index === 0 ? "сегодня" : fullDayFormatter.format(day.date)}: ${day.count}`}
              aria-pressed={flowSelection?.kind === "day" && startOfDay(flowSelection.date).getTime() === day.date.getTime()}
              onClick={() => selectFlow({ kind: "day", date: day.date, label: index === 0 ? "Сегодня" : fullDayFormatter.format(day.date) })}
            >
              <span><i style={{ height: `${Math.max(day.count ? 16 : 3, day.count / maximumDayCount * 100)}%` }} /></span>
              <strong>{day.count}</strong>
              <small>{index === 0 ? "сегодня" : shortDayFormatter.format(day.date)}</small>
            </button>)}
          </div>
        </div>
      </aside>
    </div>

    {flowSelection ? <aside className="team-dash-flow-drawer" role="dialog" aria-modal="false" aria-labelledby="team-flow-drawer-title">
      <header>
        {drawerTask ? <Button appearance="subtle" icon={<ArrowLeft20Regular />} aria-label="Вернуться к списку задач" onClick={() => setDrawerTaskId(undefined)} /> : <span className="team-dash-drawer-mark"><Clock24Regular /></span>}
        <div>
          <span>{flowSelection.kind === "status" ? "Статус потока" : "Срок выполнения"}</span>
          <h2 id="team-flow-drawer-title">{drawerTask?.title ?? flowSelection.label}</h2>
        </div>
        <Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть список задач" onClick={() => { setFlowSelection(undefined); setDrawerTaskId(undefined); }} />
      </header>
      {drawerTask ? <div className="team-dash-drawer-detail" key={drawerTask.id}>
        <EmployeeProfileLink userId={drawerTask.assigneeId} personName={personById.get(drawerTask.assigneeId)?.name ?? "Сотрудник"} className="team-dash-drawer-person">
          <Avatar name={personById.get(drawerTask.assigneeId)?.name ?? "Сотрудник"} size={40} color="colorful" />
          <span><small>Ответственный</small><strong>{personById.get(drawerTask.assigneeId)?.name ?? "Сотрудник"}</strong></span>
        </EmployeeProfileLink>
        <dl>
          <div><dt>Статус</dt><dd>{isTaskOverdue(drawerTask, now) ? "Просрочена" : taskStatusLabels[drawerTask.status]}</dd></div>
          <div><dt>Проект</dt><dd>{drawerTask.project || "Без проекта"}</dd></div>
          <div><dt>Срок</dt><dd>{drawerTask.dueLabel}</dd></div>
          <div><dt>Прогресс</dt><dd>{drawerTask.checklistTotal ? `${drawerTask.checklistDone} из ${drawerTask.checklistTotal}` : "Без чек-листа"}</dd></div>
        </dl>
        <section><span>Описание</span><p>{drawerTask.description || "Описание для этой задачи пока не добавлено."}</p></section>
        <Button appearance="primary" onClick={() => onSelectTask(drawerTask.id)}>Открыть полную карточку</Button>
      </div> : <div className="team-dash-drawer-list-wrap" key={`${flowSelection.kind}-${flowSelection.kind === "status" ? flowSelection.key : flowSelection.date.toISOString()}`}>
        <div className="team-dash-drawer-summary"><strong>{sortedFlowSelectionTasks.length}</strong><span>{pluralForm(sortedFlowSelectionTasks.length, ["задача", "задачи", "задач"])} в выбранной группе</span></div>
        <div className="team-dash-drawer-list">
          {sortedFlowSelectionTasks.map((task) => {
            const assignee = personById.get(task.assigneeId);
            return <button type="button" key={task.id} onClick={() => setDrawerTaskId(task.id)}>
              <span className={`team-dash-drawer-status status-${isTaskOverdue(task, now) ? "overdue" : task.status}`} aria-hidden="true" />
              <span><strong>{task.title}</strong><small>{task.project || "Без проекта"} · {task.dueLabel}</small></span>
              <EmployeeProfileLink userId={assignee?.id} personName={assignee?.name ?? "Сотрудник"}><Avatar name={assignee?.name ?? "Сотрудник"} size={32} color="colorful" /></EmployeeProfileLink>
              <ArrowRight20Regular aria-hidden="true" />
            </button>;
          })}
          {!sortedFlowSelectionTasks.length ? <div className="team-dash-drawer-empty"><CheckmarkCircle24Regular /><strong>{flowSelection.kind === "day" ? "В этот день задач нет" : "В этой категории задач нет"}</strong><span>Выберите другой день или статус — список обновится в этой же панели.</span></div> : null}
        </div>
      </div>}
    </aside> : null}

    <section className="team-dash-panel team-dash-workload" aria-labelledby="workload-title">
      <header className="team-dash-panel-heading team-dash-workload-heading">
        <div><span>Без скрытых оценок</span><h3 id="workload-title">Текущая нагрузка</h3><p>Полоса показывает только количество активных задач относительно команды — не норму и не оценку сотрудника.</p></div>
        <div className="team-dash-filters" aria-label="Фильтр нагрузки">
          {([ ["all", "Все"], ["risk", "С просрочкой"], ["review", "На проверке"] ] as const).map(([key, label]) => <button className={teamFilter === key ? "active" : ""} aria-pressed={teamFilter === key} key={key} onClick={() => setTeamFilter(key)} type="button">{label}</button>)}
        </div>
      </header>
      {efficiencyError ? <div className="team-dash-data-note" role="status">Показана нагрузка по задачам. Данные EFF‑1 временно недоступны: {efficiencyError}</div> : null}
      <div className="team-dash-people">
        {teamRows.map((row) => <button className={`team-dash-person ${selectedPersonId === row.person.id ? "selected" : ""}`} key={row.person.id} type="button" onClick={() => setSelectedPersonId((current) => current === row.person.id ? undefined : row.person.id)}>
          <EmployeeProfileLink userId={row.person.id} personName={row.person.name}><Avatar name={row.person.name} size={40} color="colorful" /></EmployeeProfileLink>
          <EmployeeProfileLink userId={row.person.id} personName={row.person.name} className="team-dash-person-name"><strong>{row.person.name}</strong><small>{row.person.jobTitle || "Должность не указана"}</small></EmployeeProfileLink>
          <span className="team-dash-load"><span><i style={{ width: `${row.active / maximumActive * 100}%` }} /></span><small>{plural(row.active, ["активная задача", "активные задачи", "активных задач"])}</small></span>
          <span className="team-dash-person-facts">
            {row.overdue ? <b className="is-danger">{row.overdue} проср.</b> : null}
            {row.review ? <b className="is-review">{row.review} на проверке</b> : null}
            {row.soon ? <b className="is-soon">{row.soon} на неделе</b> : null}
            {!row.overdue && !row.review && !row.soon ? <b className="is-calm">без срочных рисков</b> : null}
          </span>
          <span className="team-dash-person-score"><small>В срок</small><strong>{efficiencyLoading && !row.efficiency ? "…" : row.efficiency?.percentage == null ? "—" : `${row.efficiency.percentage.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</strong></span>
          <ArrowRight20Regular aria-hidden="true" />
        </button>)}
        {!teamRows.length ? <div className="team-dash-empty compact"><PeopleTeam24Regular /><div><strong>Нет сотрудников по этому фильтру</strong><span>Выберите другой срез команды.</span></div></div> : null}
      </div>
    </section>
  </div>;
}
