import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type {
  ApprovalRequestSummary,
  CalendarEvent,
  EfficiencyOverview,
  WorkspacePerson,
  WorkspaceTask,
} from "@yuksalish/contracts";
import { Button, DialogSurface } from "@fluentui/react-components";
import { EmployeeAvatar as Avatar } from "./EmployeeAvatar";
import {
  ArrowRight20Regular,
  ArrowLeft20Regular,
  CalendarClock24Regular,
  CheckmarkCircle24Regular,
  Clock24Regular,
  Dismiss24Regular,
  Mail24Regular,
  PeopleTeam24Regular,
  Warning24Regular,
  ClipboardTask24Regular,
} from "@fluentui/react-icons";

import { TeamPresencePanel } from "./TeamPresencePanel";
import { TeamSignatureLetters, useSignatureInbox } from "./TeamSignatureLetters";
import { SkeletonBlock } from "./LoadingSkeleton";
import { TaskDeadlineDecision } from "./TaskDeadlineDecision";
import { needsTaskDeadlineDecision, pendingTaskDeadlineRequest } from "./task-deadline-request";
import { EfficiencyDeadlineExplanation } from "./EfficiencyDeadlineExplanation";
import { useContextMotion } from "./useContextMotion";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { SlidingSegmented } from "./SlidingSegmented";
import { isTaskOverdue as deadlineIsOverdue } from "./task-deadline";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { useTeamTaskProposals } from "./useTeamTaskProposals";

interface TeamDashboardViewProps {
  readonly children?: ReactNode;
  readonly token: string;
  readonly tasks: readonly WorkspaceTask[];
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly efficiency?: EfficiencyOverview;
  readonly efficiencyLoading: boolean;
  readonly efficiencyError?: string;
  readonly onSelectTask: (taskId: string) => void;
  readonly paymentRequests?: readonly ApprovalRequestSummary[];
  readonly onSelectPaymentRequest?: (requestId: string) => void;
  readonly onSelectSignatureLetter?: (letterId: string) => void;
  readonly onSelectTaskProposal?: (proposalId: string) => void;
  readonly calendarEvents?: readonly CalendarEvent[];
  readonly onCalendarResponse?: (event: CalendarEvent, status: "accepted" | "declined") => Promise<CalendarEvent | undefined>;
  readonly onDecideDeadline?: (task: WorkspaceTask, requestId: string, approved: boolean) => WorkspaceTask | undefined | Promise<WorkspaceTask | undefined>;
}

type TeamFilter = "all" | "risk" | "review";
type DecisionPanel = "overdue" | "review" | "payments" | "extensions" | "invitations" | "signatures" | "proposals";
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

const shortDayFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
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
  return deadlineIsOverdue(task, now.getTime());
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
  return `Текущий срок истёк ${plural(days, ["день", "дня", "дней"])} назад`;
}

function deadlineContext(task: WorkspaceTask, now: Date): string | undefined {
  if (task.efficiencyExcluded) return "Исключена из эффективности — процент не снижает. Причина — в маршруте задачи";
  if (!isTaskOverdue(task, now)) return undefined;
  if (task.status === "awaiting_review") return "Ожидает решения постановщика. Вовремя сданный результат не снижает процент; время сдачи — в маршруте задачи";
  return "Истёкший срок сам по себе не доказывает нарушение исполнителя. Проверьте месяц расчёта и маршрут задачи";
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

function MetricCard({ icon, label, value, note, tone, active, onSelect, loading = false }: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: number | undefined;
  readonly loading?: boolean;
  readonly note: string;
  readonly tone: "brand" | "danger" | "review" | "calm";
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  return <button type="button" onClick={onSelect} aria-haspopup="dialog" aria-pressed={active} aria-busy={loading || undefined} className={`team-dash-metric tone-${tone}`}>
    <div className="team-dash-metric-icon" aria-hidden="true">{icon}</div>
    <div className="team-dash-metric-copy"><span>{label}</span><small>{note}</small></div>
    <strong>{loading ? <SkeletonBlock width="32px" height="1em" /> : value?.toLocaleString("ru-RU") ?? "—"}</strong>
  </button>;
}

export function TeamDashboardView({
  children,
  token,
  tasks,
  people,
  currentUserId,
  efficiency,
  efficiencyLoading,
  efficiencyError,
  onSelectTask,
  paymentRequests = [],
  onSelectPaymentRequest,
  onSelectSignatureLetter,
  onSelectTaskProposal,
  calendarEvents = [],
  onCalendarResponse,
  onDecideDeadline,
}: TeamDashboardViewProps) {
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [decisionPanel, setDecisionPanel] = useState<DecisionPanel>();
  const signatureInbox = useSignatureInbox(token, currentUserId, Boolean(onSelectSignatureLetter));
  const proposalInbox = useTeamTaskProposals(token, currentUserId, Boolean(onSelectTaskProposal));
  const [selectedDeadlineTaskId, setSelectedDeadlineTaskId] = useState<string>();
  const [invitationBusyId, setInvitationBusyId] = useState<string>();
  const [invitationError, setInvitationError] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string>();
  const [flowSelection, setFlowSelection] = useState<FlowSelection>();
  const [drawerTaskId, setDrawerTaskId] = useState<string>();
  const attentionMotion = useContextMotion("team-attention");
  const workloadMotion = useContextMotion(teamFilter);
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const currentUser = people.find((person) => person.id === currentUserId);
  const visiblePeople = people;
  const activeTasks = tasks.filter((task) => activeStatuses.has(task.status));
  const overdueTasks = activeTasks.filter((task) => isTaskOverdue(task, now));
  const teamReviewTasks = activeTasks.filter((task) => task.status === "awaiting_review");
  const reviewTasks = teamReviewTasks.filter((task) => task.authorId === currentUserId);
  const dueThisWeek = activeTasks.filter((task) => {
    const due = validDueDate(task);
    return Boolean(due && due > now && due <= weekEnd);
  });
  const efficiencyByUser = new Map(efficiency?.employees.map((employee) => [employee.userId, employee]));
  const personById = new Map(people.map((person) => [person.id, person]));
  const deadlineTasks = tasks.filter((task) => needsTaskDeadlineDecision(task, currentUserId));
  const pendingPayments = paymentRequests.filter((request) => request.status === "running"
    && request.activeStages.some((stage) => stage.canAct));
  const pendingInvitations = calendarEvents.filter((event) => event.status === "scheduled"
    && event.canRespond && (event.currentUserAttendanceStatus ?? "pending") === "pending"
    && new Date(event.endsAt).getTime() > now.getTime());
  const respondToInvitation = async (event: CalendarEvent, status: "accepted" | "declined") => {
    if (!onCalendarResponse || invitationBusyId) return;
    setInvitationBusyId(event.id);
    setInvitationError("");
    try {
      if (!await onCalendarResponse(event, status)) setInvitationError("Ответ не сохранён. Повторите попытку.");
    } catch (error) {
      setInvitationError(error instanceof Error ? error.message : "Не удалось сохранить ответ.");
    } finally {
      setInvitationBusyId(undefined);
    }
  };

  const attentionTasks = tasks
    .map((task) => ({ task, attention: taskAttention(task, now) }))
    .filter((item): item is { task: WorkspaceTask; attention: NonNullable<ReturnType<typeof taskAttention>> } => item.attention !== undefined)
    .filter(({ task }) => task.status !== "awaiting_review" || task.authorId === currentUserId)
    .sort((left, right) => right.attention.score - left.attention.score)
    .slice(0, 8);

  const teamRows = (() => {
    const rows = visiblePeople.map((person) => {
      const assigned = activeTasks.filter((task) => task.assigneeId === person.id);
      const expiredTasks = assigned.filter((task) => isTaskOverdue(task, now));
      const overdue = expiredTasks.length;
      const excludedExpired = expiredTasks.filter((task) => task.efficiencyExcluded).length;
      const review = assigned.filter((task) => task.status === "awaiting_review").length;
      const soon = assigned.filter((task) => {
        const due = validDueDate(task);
        return Boolean(due && due > now && due <= weekEnd);
      }).length;
      return { person, active: assigned.length, overdue, excludedExpired, review, soon, efficiency: efficiencyByUser.get(person.id) };
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
    { key: "progress", label: "В работе", value: activeTasks.filter((task) => ["in_progress", "overdue"].includes(task.status) && !isTaskOverdue(task, now)).length },
    { key: "review", label: "На проверке в команде", value: teamReviewTasks.filter(task => !isTaskOverdue(task, now)).length },
    { key: "overdue", label: "Срок истёк", value: overdueTasks.length },
  ];
  const firstName = currentUser?.name.split(" ")[0] ?? "руководитель";
  const flowSelectionTasks = flowSelection?.kind === "status"
    ? activeTasks.filter((task) => {
      if (flowSelection.key === "overdue") return isTaskOverdue(task, now);
      if (isTaskOverdue(task, now)) return false;
      if (flowSelection.key === "new") return task.status === "new";
      if (flowSelection.key === "progress") return task.status === "in_progress" || task.status === "overdue";
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
  const selectedPerson = people.find((person) => person.id === selectedPersonId);
  const selectedPersonTasks = activeTasks
    .filter((task) => task.assigneeId === selectedPersonId)
    .sort((left, right) => (validDueDate(left)?.getTime() ?? Number.POSITIVE_INFINITY)
      - (validDueDate(right)?.getTime() ?? Number.POSITIVE_INFINITY));
  const decisionTitles: Readonly<Record<DecisionPanel, string>> = {
    overdue: "Задачи, которым нужна помощь",
    review: "Результаты на вашей проверке",
    payments: "Заявки на оплату, ожидающие решения",
    extensions: "Запросы на перенос срока",
    invitations: "Приглашения на мероприятия и встречи",
    signatures: "Письма, ожидающие вашей подписи",
    proposals: "Запросы на постановку задач",
  };
  const openTask = (taskId: string) => { setDecisionPanel(undefined); setSelectedPersonId(undefined); onSelectTask(taskId); };

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
    <WorkspaceSectionHeader motif="team" className="team-dash-hero" aria-labelledby="team-dashboard-title">
      <div className="team-dash-hero-copy">
        <span>Обзор команды · сегодня</span>
        <h2 id="team-dashboard-title">Добрый день, {firstName}</h2>
        <p>{overdueTasks.length || reviewTasks.length
          ? `В фокусе ${plural(overdueTasks.length + reviewTasks.length, ["задача", "задачи", "задач"])}: истёкшие сроки команды и результаты на вашей проверке.`
          : "Срочных блокеров нет. Можно сосредоточиться на задачах ближайших семи дней."}</p>
      </div>
      <div className="team-dash-hero-summary" aria-label="Краткая сводка команды">
        <PeopleTeam24Regular aria-hidden="true" />
        <div><strong>{visiblePeople.length}</strong><span>сотрудников в обзоре</span></div>
      </div>
    </WorkspaceSectionHeader>

    <section className="team-dash-metrics" aria-label="Ключевые показатели команды">
      <MetricCard active={decisionPanel === "overdue"} onSelect={() => setDecisionPanel("overdue")} icon={<Warning24Regular />} label="Нужна помощь" value={overdueTasks.length} note={overdueTasks.length ? "истёк текущий срок" : "истёкших сроков нет"} tone="danger" />
      <MetricCard active={decisionPanel === "review"} onSelect={() => setDecisionPanel("review")} icon={<CheckmarkCircle24Regular />} label="Ждут решения" value={reviewTasks.length} note="задачи, где вы постановщик" tone="review" />
      {onSelectPaymentRequest ? <MetricCard active={decisionPanel === "payments"} onSelect={() => setDecisionPanel("payments")} icon={<CheckmarkCircle24Regular />} label="Заявки на оплату" value={pendingPayments.length} note="ждут вашего решения" tone="brand" /> : null}
      <MetricCard active={decisionPanel === "extensions"} onSelect={() => setDecisionPanel("extensions")} icon={<Clock24Regular />} label="Перенос срока" value={deadlineTasks.length} note="запросы на ваше решение" tone="review" />
      <MetricCard active={decisionPanel === "invitations"} onSelect={() => setDecisionPanel("invitations")} icon={<CalendarClock24Regular />} label="Приглашения" value={pendingInvitations.length} note="ожидают вашего ответа" tone="brand" />
      {onSelectSignatureLetter ? <MetricCard active={decisionPanel === "signatures"} onSelect={() => setDecisionPanel("signatures")} icon={<Mail24Regular />} label="Письма на подпись" value={signatureInbox.registry?.totalCount} loading={signatureInbox.loading} note={signatureInbox.error ? "не удалось загрузить · подробнее" : signatureInbox.loading ? "загружаем письма…" : "ждут вашей подписи"} tone="review" /> : null}
      {onSelectTaskProposal ? <MetricCard active={decisionPanel === "proposals"} onSelect={() => setDecisionPanel("proposals")} icon={<ClipboardTask24Regular />} label="Постановка задач" value={proposalInbox.proposals?.length} loading={proposalInbox.loading} note={proposalInbox.error ? "не удалось загрузить · подробнее" : "запросы сотрудников на ваше решение"} tone="brand" /> : null}
    </section>
    <WorkspaceDialog open={Boolean(decisionPanel)} onOpenChange={(_, data) => { if (!data.open) setDecisionPanel(undefined); }}>
      <DialogSurface className="team-dash-dialog" aria-label={decisionPanel ? decisionTitles[decisionPanel] : "Решения команды"}>
      {decisionPanel ? <section className="team-dash-decisions" role="region" aria-label={decisionTitles[decisionPanel]}>
      <header><div><span>Входящие решения</span><h3>{decisionTitles[decisionPanel]}</h3></div><Button appearance="subtle" onClick={() => setDecisionPanel(undefined)}>Закрыть</Button></header>
      {decisionPanel === "overdue" || decisionPanel === "review" ? (decisionPanel === "overdue" ? overdueTasks : reviewTasks).length ? (decisionPanel === "overdue" ? overdueTasks : reviewTasks).map((task) => <button type="button" className="team-dash-payment-item" key={task.id} onClick={() => openTask(task.id)}><strong>{task.title}</strong><span>{personById.get(task.assigneeId)?.name ?? "Сотрудник"} · {task.dueLabel} · {decisionPanel === "overdue" ? overdueLabel(task, now) : "Вы постановщик"}</span><ArrowRight20Regular aria-hidden="true" /></button>) : <p>{decisionPanel === "overdue" ? "Задач с истёкшим сроком нет." : "Ваших задач, ожидающих проверки, нет."}</p> : null}
      {decisionPanel === "signatures" && onSelectSignatureLetter ? <TeamSignatureLetters inbox={signatureInbox} onSelect={(id) => { setDecisionPanel(undefined); onSelectSignatureLetter(id); }} /> : null}
      {decisionPanel === "payments" ? pendingPayments.length ? pendingPayments.map((request) => <button type="button" className="team-dash-payment-item" key={request.id} onClick={() => onSelectPaymentRequest?.(request.id)}><strong>{request.title}</strong><span>№ {request.number} · {request.stageLabel}</span><ArrowRight20Regular aria-hidden="true" /></button>) : <p>Заявок на оплату, ожидающих вашего решения, нет.</p>
      : null}
      {decisionPanel === "extensions" ? deadlineTasks.length ? deadlineTasks.map((task) => {
        const request = pendingTaskDeadlineRequest(task);
        return request ? <div className="team-dash-decision-item" key={request.id}>
          <button type="button" aria-expanded={selectedDeadlineTaskId === task.id} onClick={() => setSelectedDeadlineTaskId((current) => current === task.id ? undefined : task.id)}><strong>{task.title}</strong><span>Предлагаемый срок: {new Date(request.proposedDueAt).toLocaleString("ru-RU")}</span></button>
          {selectedDeadlineTaskId === task.id ? <><TaskDeadlineDecision task={task} request={request} people={people} canDecide={Boolean(onDecideDeadline)} onDecide={onDecideDeadline} onResolved={() => setSelectedDeadlineTaskId(undefined)} /><Button appearance="subtle" onClick={() => openTask(task.id)}>Открыть задачу</Button></> : null}
        </div> : null;
      }) : <p>Запросов на перенос срока нет.</p> : null}
      {decisionPanel === "invitations" ? pendingInvitations.length ? pendingInvitations.map((event) => <article className="team-dash-decision-item" key={event.id}>
        <strong>{event.title}</strong><span>{new Date(event.startsAt).toLocaleString("ru-RU")}{event.location ? ` · ${event.location}` : ""}</span>
        {event.description ? <p>{event.description}</p> : null}
        <div><Button appearance="primary" disabled={Boolean(invitationBusyId) || !onCalendarResponse} onClick={() => void respondToInvitation(event, "accepted")}>Подтвердить участие</Button><Button disabled={Boolean(invitationBusyId) || !onCalendarResponse} onClick={() => void respondToInvitation(event, "declined")}>Отказаться</Button></div>
      </article>) : <p>Приглашений, ожидающих ответа, нет.</p> : null}
      {decisionPanel === "proposals" && onSelectTaskProposal ? <>
        <p>Сотрудник предлагает задачу от вашего имени. До вашего подтверждения она не становится рабочей задачей.</p>
        {proposalInbox.error ? <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={proposalInbox.refresh}>Повторить загрузку</Button>}>{proposalInbox.error}</WorkspaceNotice> : null}
        {proposalInbox.loading ? <p role="status">Загружаем запросы…</p> : null}
        {proposalInbox.proposals?.map((proposal) => <button type="button" className="team-dash-payment-item" key={proposal.id} onClick={() => { setDecisionPanel(undefined); onSelectTaskProposal(proposal.id); }}><strong>{proposal.task.title}</strong><span>{personById.get(proposal.creatorUserId)?.name ?? "Сотрудник"} · {proposal.task.dueAt ? new Date(proposal.task.dueAt).toLocaleString("ru-RU") : "Без срока"}</span><ArrowRight20Regular aria-hidden="true" /></button>)}
        {proposalInbox.proposals?.length === 0 ? <p>Запросов на постановку задач, ожидающих вашего решения, нет.</p> : null}
      </> : null}
      {invitationError && decisionPanel === "invitations" ? <WorkspaceNotice tone="error" role="alert">{invitationError}</WorkspaceNotice> : null}
    </section> : null}
      </DialogSurface>
    </WorkspaceDialog>

    <div className="team-dash-main-grid">
      <section className="team-dash-panel team-dash-attention" aria-labelledby="attention-title">
        <header className="team-dash-panel-heading">
          <div><span>Следующее действие</span><h3 id="attention-title">Требует внимания</h3></div>
          <small>сначала самое срочное</small>
        </header>
        <div className="team-dash-attention-list" ref={attentionMotion}>
          {attentionTasks.map(({ task, attention }) => {
            const assignee = personById.get(task.assigneeId);
            return <button className={`team-dash-task tone-${attention.tone}`} key={task.id} type="button" onClick={() => onSelectTask(task.id)}>
              <span className="team-dash-task-signal" aria-hidden="true" />
              <span className="team-dash-task-copy"><strong>{task.title}</strong><small>{task.project} · {attention.label}</small>{deadlineContext(task, now) ? <small>{deadlineContext(task, now)}</small> : null}</span>
              <EmployeeProfileLink userId={assignee?.id} personName={assignee?.name ?? "Сотрудник"} className="team-dash-task-person"><Avatar name={assignee?.name ?? "Сотрудник"} size={28} /><span>{assignee?.name ?? "Сотрудник"}</span></EmployeeProfileLink>
              <ArrowRight20Regular aria-hidden="true" />
            </button>;
          })}
          {!attentionTasks.length ? <div className="team-dash-empty"><CheckmarkCircle24Regular /><div><strong>Всё спокойно</strong><span>Задач с истёкшим или срочным сроком и ваших результатов на проверке сейчас нет.</span></div></div> : null}
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
          <div className="team-dash-flow-legend" role="group" aria-label="Задачи по статусам">
            {flowParts.map((part) => <button
              type="button"
              className={`flow-${part.key}`}
              aria-pressed={flowSelection?.kind === "status" && flowSelection.key === part.key}
              key={part.key}
              onClick={() => selectFlow({ kind: "status", key: part.key, label: part.label })}
            ><span><i className={`part-${part.key}`} /><span className="team-dash-flow-label" title={part.label}>{part.label}</span></span><strong>{part.value}</strong></button>)}
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
              title={fullDayFormatter.format(day.date)}
              aria-pressed={flowSelection?.kind === "day" && startOfDay(flowSelection.date).getTime() === day.date.getTime()}
              onClick={() => selectFlow({ kind: "day", date: day.date, label: index === 0 ? "Сегодня" : fullDayFormatter.format(day.date) })}
            >
              <span aria-hidden="true"><i style={{ height: `${Math.max(day.count ? 16 : 3, day.count / maximumDayCount * 100)}%` }} /></span>
              <strong>{day.count}</strong>
              <small aria-hidden="true">
                {index === 0 ? <span><span className="team-dash-week-today-full">сегодня</span><span className="team-dash-week-today-short">сег.</span></span>
                  : <span>{shortDayFormatter.format(day.date)}</span>}
                <span>{day.date.getDate()}</span>
              </small>
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
          <div><dt>Статус</dt><dd>{isTaskOverdue(drawerTask, now) ? "Истёк текущий срок" : drawerTask.status === "overdue" ? "В работе" : taskStatusLabels[drawerTask.status]}</dd></div>
          <div><dt>Проект</dt><dd>{drawerTask.project || "Без проекта"}</dd></div>
          <div><dt>Срок</dt><dd>{drawerTask.dueLabel}</dd></div>
          <div><dt>Прогресс</dt><dd>{drawerTask.checklistTotal ? `${drawerTask.checklistDone} из ${drawerTask.checklistTotal}` : "Без чек-листа"}</dd></div>
          <div><dt>Учёт в эффективности</dt><dd>{deadlineContext(drawerTask, now) ?? "По истории сроков и сдачи результата, не только по текущему статусу"}</dd></div>
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
              <span><strong>{task.title}</strong><small>{task.project || "Без проекта"} · {task.dueLabel}</small>{deadlineContext(task, now) ? <small>{deadlineContext(task, now)}</small> : null}</span>
              <EmployeeProfileLink userId={assignee?.id} personName={assignee?.name ?? "Сотрудник"}><Avatar name={assignee?.name ?? "Сотрудник"} size={32} color="colorful" /></EmployeeProfileLink>
              <ArrowRight20Regular aria-hidden="true" />
            </button>;
          })}
          {!sortedFlowSelectionTasks.length ? <div className="team-dash-drawer-empty"><CheckmarkCircle24Regular /><strong>{flowSelection.kind === "day" ? "В этот день задач нет" : "В этой категории задач нет"}</strong><span>Выберите другой день или статус — список обновится в этой же панели.</span></div> : null}
        </div>
      </div>}
    </aside> : null}

    {["manager", "admin", "superadmin"].includes(currentUser?.role ?? "")
      ? <TeamPresencePanel token={token} /> : null}

    <section className="team-dash-panel team-dash-workload" aria-labelledby="workload-title">
      <header className="team-dash-panel-heading team-dash-workload-heading">
        <div><span>Без скрытых оценок</span><h3 id="workload-title">Текущая нагрузка</h3><p>Полоса показывает только количество активных задач относительно команды — не норму и не оценку сотрудника.</p><p>«Истёк срок» — текущие дедлайны. Процент справа — эффективность{efficiency ? ` за ${new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${efficiency.period}-01T00:00:00Z`))}` : " за месяц"}, а не доля активных задач без просрочки.</p></div>
        <SlidingSegmented className="team-dash-filters" role="group" aria-label="Фильтр нагрузки">
          {([ ["all", "Все"], ["risk", "Истёк срок"], ["review", "На проверке"] ] as const).map(([key, label]) => <button className={teamFilter === key ? "active" : ""} aria-pressed={teamFilter === key} key={key} onClick={() => setTeamFilter(key)} type="button">{label}</button>)}
        </SlidingSegmented>
      </header>
      <EfficiencyDeadlineExplanation />
      {efficiencyError ? <WorkspaceNotice tone="warning" className="team-dash-data-note" role="status">Показана нагрузка по задачам. Данные эффективности временно недоступны: {efficiencyError}</WorkspaceNotice> : null}
      <div className="team-dash-people" ref={workloadMotion} role="region" aria-label="Нагрузка сотрудников" tabIndex={0}>
        {teamRows.map((row) => <button className="team-dash-person" key={row.person.id} type="button" aria-haspopup="dialog" aria-label={`Посмотреть нагрузку: ${row.person.name}, ${plural(row.active, ["активная задача", "активные задачи", "активных задач"])}`} onClick={() => setSelectedPersonId(row.person.id)}>
          <span><Avatar name={row.person.name} size={40} color="colorful" /></span>
          <span className="team-dash-person-name"><strong>{row.person.name}</strong><small>{row.person.jobTitle || "Должность не указана"}</small></span>
          <span className="team-dash-load"><span><i style={{ width: `${row.active / maximumActive * 100}%` }} /></span><small>{plural(row.active, ["активная задача", "активные задачи", "активных задач"])}</small></span>
          <span className="team-dash-person-facts">
            {row.overdue ? <><b className="is-soon">Истёк срок: {row.overdue}</b><small>Счётчик сроков, не нарушений исполнителя</small>{row.excludedExpired ? <b className="is-calm">Из них не снижают процент: {row.excludedExpired} · исключены</b> : null}</> : null}
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
    <WorkspaceDialog open={Boolean(selectedPerson)} onOpenChange={(_, data) => { if (!data.open) setSelectedPersonId(undefined); }}>
      <DialogSurface className="team-dash-dialog team-dash-workload-dialog" aria-label={selectedPerson ? `Нагрузка: ${selectedPerson.name}` : "Нагрузка сотрудника"}>
        {selectedPerson ? <section className="team-dash-decisions" role="region" aria-label={`Задачи и сроки: ${selectedPerson.name}`}>
          <header><div><span>Нагрузка сотрудника</span><h3>{selectedPerson.name}</h3><p>{selectedPerson.jobTitle || "Должность не указана"} · {plural(selectedPersonTasks.length, ["активная задача", "активные задачи", "активных задач"])}</p></div><Button appearance="subtle" onClick={() => setSelectedPersonId(undefined)}>Закрыть</Button></header>
          <p>Показаны текущие задачи и сроки. Истёкший срок не означает автоматически нарушение исполнителя — смотрите историю в карточке.</p>
          <div className="team-dash-workload-list" role="list" aria-label="Задачи сотрудника">
            {selectedPersonTasks.map((task) => <div role="listitem" key={task.id}><button type="button" className="team-dash-payment-item" onClick={() => openTask(task.id)}>
              <strong>{task.title}</strong>
              <span>{task.project || "Без проекта"} · {isTaskOverdue(task, now) ? "Истёк срок" : taskStatusLabels[task.status]} · {validDueDate(task)?.toLocaleString("ru-RU") ?? "Без срока"}</span>
              <ArrowRight20Regular aria-hidden="true" />
            </button>{deadlineContext(task, now) ? <small>{deadlineContext(task, now)}</small> : null}</div>)}
            {!selectedPersonTasks.length ? <p>У сотрудника сейчас нет активных задач.</p> : null}
          </div>
        </section> : null}
      </DialogSurface>
    </WorkspaceDialog>
    {children}
  </div>;
}
