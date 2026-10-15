import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { CalendarAudienceActions } from "./CalendarAudienceActions";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  CalendarEvent,
  CalendarAttendanceStatus,
  CalendarEventInput,
  CalendarEventType,
  ApprovalRequestSummary,
  PaymentProjectTargets,
  WorkspacePerson,
  WorkspaceDepartment,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
  ZoomMeeting,
} from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Input, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowLeft20Regular,
  ChevronLeft24Regular,
  ChevronRight24Regular,
} from "@fluentui/react-icons";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { TaskComposer } from "./TaskComposer";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import {
  CalendarEventComposer,
  type PreparedEventPayment,
  type PreparedEventTask,
} from "./CalendarEventComposer";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { loadCalendarProjectTargets, type PaymentRequestInput } from "./workspace-api";
import { CalendarProjectLinkFields } from "./CalendarProjectLinkFields";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { employeeScope, type EmployeeScope } from "./employee-scope";
import { useCalendarEventClock } from "./useCalendarEventClock";
import { CalendarAppearance, CalendarIcon, calendarAppearanceStyle } from "./CalendarAppearance";
import { CalendarFilters } from "./CalendarFilters";
import { CalendarSchedule } from "./CalendarSchedule";
import { CalendarAgendaDrawer } from "./CalendarAgendaDrawer";
import { CalendarEventDialog } from "./CalendarEventDialog";
import { CalendarZoomDetails } from "./CalendarZoomDetails";
import { SlidingSegmented } from "./SlidingSegmented";
import { calendarDayInRange, calendarItemsOnDay, emptyCalendarFilters, filterCalendarSchedule, type CalendarFilters as Filters } from "./calendar-filters";
import "./calendar-ux.css";

interface CalendarViewProps {
  readonly token?: string;
  readonly canLinkProjects?: boolean;
  readonly canInviteCalendarAudience?: boolean;
  readonly focusEventId?: string;
  readonly createFromChat?: {
    readonly key: string;
    readonly title: string;
    readonly attendeeIds: readonly string[];
  };
  readonly events: readonly CalendarEvent[];
  /** Used only by an event's linked work and the task composer. */
  readonly tasks?: readonly WorkspaceTask[];
  readonly requests?: readonly ApprovalRequestSummary[];
  readonly onOpenTask?: (taskId: string) => void;
  /** Conferences of the shared Zoom host, shown read-only next to the events. */
  readonly zoomMeetings?: readonly ZoomMeeting[];
  readonly onOpenZoomMeeting?: (meetingId: string) => void;
  readonly people: readonly WorkspacePerson[];
  readonly departments?: readonly WorkspaceDepartment[];
  readonly currentUserId: string;
  readonly onCreate: (payload: CalendarEventInput) => Promise<CalendarEvent | undefined>;
  readonly onUpdate: (
    event: CalendarEvent,
    payload: CalendarEventInput,
  ) => Promise<CalendarEvent | undefined>;
  readonly onCancel: (event: CalendarEvent) => Promise<CalendarEvent | undefined>;
  readonly onCreateTask?: (
    payload: WorkspaceTaskCreateInput,
  ) => Promise<WorkspaceTask | undefined>;
  readonly canCreatePaymentRequest?: boolean;
  readonly onCreatePayment?: (
    payload: PaymentRequestInput,
  ) => Promise<ApprovalRequestSummary | undefined>;
  readonly onRespond?: (
    event: CalendarEvent,
    status: "accepted" | "declined",
  ) => Promise<CalendarEvent | undefined>;
}

const typeLabels: Record<CalendarEventType, string> = {
  meeting: "Встреча",
  deadline: "Срок",
  trip: "Командировка",
  task: "Задача",
  general: "Мероприятие",
};

const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function localInput(value: Date): string {
  if (!Number.isFinite(value.getTime())) return "";
  const adjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function dayKey(value: Date): string {
  if (!Number.isFinite(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function isPastDay(value: Date): boolean {
  return startOfDay(value).getTime() < startOfDay(new Date()).getTime();
}

function dateLabel(value: Date, weekday = true): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: weekday ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

function eventTime(event: CalendarEvent): string {
  if (event.allDay) return "Весь день";
  const format = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${format.format(new Date(event.startsAt))}–${format.format(new Date(event.endsAt))}`;
}

const attendanceLabels: Record<CalendarAttendanceStatus, string> = {
  accepted: "Участвует",
  pending: "Ожидает ответа",
  declined: "Отказался",
};

function attendanceStatus(event: CalendarEvent, userId: string): CalendarAttendanceStatus | undefined {
  const attendee = event.attendees.find((item) => item.userId === userId);
  if (attendee) return attendee.status;
  return event.attendeeIds.includes(userId) ? "accepted" : undefined;
}

function emptyDraft(currentUserId: string, date = new Date()): CalendarEventInput {
  const start = new Date(date);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    description: "",
    eventType: "meeting",
    startsAt: localInput(start),
    endsAt: localInput(end),
    allDay: false,
    location: "",
    attendeeIds: [currentUserId],
    color: "#4C96A5",
    iconKey: "meeting",
  };
}

function editDraft(event: CalendarEvent): CalendarEventInput {
  return {
    title: event.title,
    description: event.description,
    eventType: event.eventType,
    color: event.color ?? null,
    iconKey: event.iconKey ?? "meeting",
    startsAt: localInput(new Date(event.startsAt)),
    endsAt: localInput(new Date(event.endsAt)),
    allDay: event.allDay,
    location: event.location,
    attendeeIds: event.attendeeIds,
    projectId: event.projectId ?? null,
    workstreamId: event.workstreamId ?? null,
    projectItemId: event.projectItemId ?? null,
  };
}

export function CalendarView({
  token = "",
  canLinkProjects = false,
  canInviteCalendarAudience = false,
  focusEventId,
  createFromChat,
  events,
  tasks,
  requests,
  onOpenTask,
  zoomMeetings,
  onOpenZoomMeeting,
  people,
  departments,
  currentUserId,
  onCreate,
  onUpdate,
  onCancel,
  onCreateTask,
  canCreatePaymentRequest,
  onCreatePayment,
  onRespond,
}: CalendarViewProps) {
  const eventFocusTarget = useRestoreFocusTarget();
  const agendaFocusTarget = useRestoreFocusTarget();
  const [agendaCompact, setAgendaCompact] = useState(false);
  const [agendaDense, setAgendaDense] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const agendaEventReturnTarget = useRef<HTMLElement | null>(null);
  const agendaReturnTarget = useRef<HTMLElement | null>(null);
  const calendarNow = useCalendarEventClock(events);
  const focusedEvent = events.find((event) => event.id === focusEventId);
  const focusedDate = focusedEvent ? new Date(focusedEvent.startsAt) : new Date();
  const initialDate = Number.isFinite(focusedDate.getTime()) ? focusedDate : new Date();
  const [month, setMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(initialDate));
  const [filters, setFilters] = useState<Filters>(emptyCalendarFilters);
  const [view, setView] = useState<"month" | "list">("month");
  const [listLimit, setListLimit] = useState(100);
  const pendingDayFocus = useRef<string | undefined>(undefined);
  const [selectedState, setSelected] = useState<CalendarEvent | undefined>(focusedEvent);
  const [selectedZoomState, setSelectedZoom] = useState<ZoomMeeting>();
  const [draft, setDraft] = useState<CalendarEventInput>();
  const [editAttendeeScope, setEditAttendeeScope] = useState<EmployeeScope>("central");
  const activePeople = people.filter(person => !person.status || person.status === "active");
  const selectAudience = (scope: NonNullable<CalendarEventInput["audienceScope"]>) => {
    if (!canInviteCalendarAudience || !draft || busy) return;
    setDraft({ ...draft, audienceScope: scope, attendeeIds: [...new Set([currentUserId,
      ...activePeople.filter(person => scope === "all" || (departments
        && employeeScope(person.departmentId, departments) === scope)).map(person => person.id),
    ])] });
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [availabilityWarning, setAvailabilityWarning] = useState("");
  const chairmanIds = useMemo(() => new Set(people.filter(person =>
    (person.jobTitle ?? "").replace(/[‘’ʻʼ`]/g, "'").trim().replace(/\s+/g, " ").toLowerCase() === '"yuksalish" harakati raisi, qonunchilik palatasi qo\'mita raisi'
  ).map(person => person.id)), [people]);
  const warnChairman = (person: WorkspacePerson) => setAvailabilityWarning(`${person.name} уже занят в это время: участие в другом событии подтверждено. Выберите другое время или уберите его из участников.`);
  const [projectTargets, setProjectTargets] = useState<PaymentProjectTargets>({ projects: [], workstreams: [], items: [] });
  const [projectTargetsLoading, setProjectTargetsLoading] = useState(false);
  const [projectTargetsError, setProjectTargetsError] = useState("");
  const [projectTargetsAttempt, setProjectTargetsAttempt] = useState(0);
  useEffect(() => {
    if (!canLinkProjects) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setProjectTargetsLoading(true);
      void loadCalendarProjectTargets(token)
        .then((targets) => { if (active) { setProjectTargets(targets); setProjectTargetsError(""); } })
        .catch(() => { if (active) setProjectTargetsError("Не удалось загрузить доступные проекты."); })
        .finally(() => { if (active) setProjectTargetsLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [token, canLinkProjects, projectTargetsAttempt]);
  const [taskComposerEvent, setTaskComposerEvent] = useState<CalendarEvent>();
  const [paymentEvent, setPaymentEvent] = useState<CalendarEvent>();
  const [paymentTitle, setPaymentTitle] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [preparedTasks, setPreparedTasks] = useState<readonly PreparedEventTask[]>([]);
  const [preparedPayment, setPreparedPayment] = useState<PreparedEventPayment>();
  const lastChatDraftKey = useRef<string | undefined>(undefined);
  const nextPreparedTaskKey = useRef(1);
  const sideRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      // Measure the available work area, not a guessed device/viewport type.
      const frameWidth = frame.offsetWidth || frame.clientWidth;
      const frameHeight = Math.min(frame.offsetHeight || frame.clientHeight || window.innerHeight, window.innerHeight);
      if (frameWidth > 0) {
        // Border-box width is stable when a scrollbar appears/disappears;
        // choosing the mode from clientWidth can oscillate at the breakpoint.
        const compact = frameWidth < 720 || (frameWidth < 1000 && frameHeight < 560);
        setAgendaCompact(compact);
        setAgendaDense(frameWidth < 1000);
        if (!compact) setAgendaOpen(false);
      }
      const style = getComputedStyle(frame);
      const borders = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
      const inset = `${Math.max(0, frame.offsetWidth - frame.clientWidth - borders)}px`;
      if (frame.style.getPropertyValue("--ws-calendar-scrollbar-inset") !== inset) {
        frame.style.setProperty("--ws-calendar-scrollbar-inset", inset);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month);
  const selected = events.find((item) => item.id === selectedState?.id) ?? selectedState;
  const selectedZoom = zoomMeetings?.find(item => item.id === selectedZoomState?.id) ?? selectedZoomState;
  const selectedDayIsPast = isPastDay(selectedDay);
  const schedule = useMemo(() => filterCalendarSchedule(events, zoomMeetings ?? [], filters), [events, zoomMeetings, filters]);
  const monthStart = month.getTime();
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
  const monthItems = schedule.filter(item => Date.parse(item.record.startsAt) < monthEnd && Date.parse(item.record.endsAt) > monthStart);
  const listItems = filters.from || filters.to ? schedule : monthItems;
  const selectedDayItems = calendarItemsOnDay(schedule, selectedDay, filters);
  const hasFilters = Boolean(filters.employeeId || filters.query.trim() || filters.from || filters.to || !filters.showCancelled);
  const changeFilters = (next: Filters) => {
    setFilters(next); setListLimit(100); setSelected(undefined); setSelectedZoom(undefined); setError("");
    if (next.from !== filters.from || next.to !== filters.to) {
      setView("list"); setAgendaOpen(false);
      const date = new Date(`${next.from || next.to}T00:00:00`);
      if (Number.isFinite(date.getTime())) {
        setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
        setSelectedDay(startOfDay(date));
      }
    }
  };
  const resetFilters = () => { setFilters(emptyCalendarFilters); setListLimit(100); setSelected(undefined); setSelectedZoom(undefined); };
  const openScheduleEvent = (event: CalendarEvent) => {
    if (draft || busy) return;
    agendaEventReturnTarget.current = agendaCompact && agendaOpen ? document.activeElement as HTMLElement : null;
    setSelected(event); setSelectedZoom(undefined); setDraft(undefined); setError("");
    if (view === "list") setSelectedDay(startOfDay(new Date(event.startsAt)));
  };
  const openZoomEvent = (meeting: ZoomMeeting) => {
    if (draft || busy) return;
    agendaEventReturnTarget.current = agendaCompact && agendaOpen ? document.activeElement as HTMLElement : null;
    setSelected(undefined); setSelectedZoom(meeting); setError("");
  };
  useLayoutEffect(() => {
    const key = pendingDayFocus.current;
    if (!key) return;
    frameRef.current?.querySelector<HTMLElement>(`[data-calendar-day="${key}"]`)?.focus();
    pendingDayFocus.current = undefined;
  }, [month, selectedDay]);
  const linkedTasks = selected
    ? (tasks ?? []).filter((task) => task.calendarEventId === selected.id)
    : [];
  const linkedPayments = selected
    ? (requests ?? []).filter((request) => request.calendarEventId === selected.id)
    : [];
  const busyAttendeeIds = useMemo(() => {
    if (!draft) return new Set<string>();
    const startsAt = new Date(draft.startsAt).getTime();
    const endsAt = new Date(draft.endsAt).getTime();
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
      return new Set<string>();
    }
    const busyIds = new Set<string>();
    for (const event of events) {
      if (event.id === selected?.id || event.status !== "scheduled") continue;
      if (new Date(event.startsAt).getTime() >= endsAt || new Date(event.endsAt).getTime() <= startsAt) {
        continue;
      }
      for (const attendee of event.attendees) {
        if (attendee.status !== "declined" && (!chairmanIds.has(attendee.userId) || attendee.status === "accepted")) busyIds.add(attendee.userId);
      }
    }
    return busyIds;
  }, [draft, events, selected?.id, chairmanIds]);
  const days = useMemo(() => {
    const firstWeekday = (month.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const visibleDayCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: visibleDayCount }, (_unused, index) => {
      const day = index - firstWeekday + 1;
      return new Date(month.getFullYear(), month.getMonth(), day);
    });
  }, [month]);
  const visibleEventsPerDay = 2;

  useEffect(() => {
    if (!createFromChat || createFromChat.key === lastChatDraftKey.current) return;
    lastChatDraftKey.current = createFromChat.key;
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(startOfDay(today));
    setSelected(undefined);
    setDraft({
      ...emptyDraft(currentUserId, today),
      title: createFromChat.title,
      attendeeIds: [...new Set([currentUserId, ...createFromChat.attendeeIds])],
    });
    setPreparedTasks([]);
    setPreparedPayment(undefined);
    setError("");
  }, [createFromChat, currentUserId]);

  const chooseDay = (day: Date, showAgenda = false) => {
    setSelectedDay(startOfDay(day));
    setSelectedZoom(undefined);
    setSelected(undefined);
    setDraft(undefined);
    setPreparedTasks([]);
    setPreparedPayment(undefined);
    setError("");
    if (showAgenda && agendaCompact) {
      agendaReturnTarget.current = document.activeElement as HTMLElement;
      setAgendaOpen(true);
    }
    if (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  };

  const createForDay = (day: Date) => {
    if (isPastDay(day)) return;
    setSelectedDay(startOfDay(day));
    setSelected(undefined);
    setDraft(emptyDraft(currentUserId, day));
    setPreparedTasks([]);
    setPreparedPayment(undefined);
    setError("");
  };

  const goToToday = () => {
    const today = new Date();
    setFilters(current => ({ ...current, from: "", to: "" }));
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    chooseDay(today);
  };

  const addPreparedTask = () => {
    const eventEnd = new Date(draft?.endsAt ?? "").getTime();
    const firstAvailableHour = Date.now() + 60 * 60 * 1000;
    setPreparedTasks((items) => [
      ...items,
      {
        key: nextPreparedTaskKey.current++,
        title: "",
        description: "",
        assigneeId: currentUserId,
        dueAt: localInput(new Date(Math.max(Number.isFinite(eventEnd) ? eventEnd : 0, firstAvailableHour))),
        priority: "normal",
      },
    ]);
  };

  const updatePreparedTask = (key: number, changes: Partial<PreparedEventTask>) => {
    setPreparedTasks((items) => items.map((item) => (
      item.key === key ? { ...item, ...changes } : item
    )));
  };

  const closeDraft = () => {
    if (busy) return;
    setDraft(undefined);
    if (!selected) {
      setPreparedTasks([]);
      setPreparedPayment(undefined);
    }
  };

  const save = async () => {
    if (!draft?.title.trim() || busy) return;
    const start = new Date(draft.startsAt);
    const end = new Date(draft.endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      setError("Укажите корректные начало и окончание. Окончание должно быть позже начала.");
      return;
    }
    if (!selected && isPastDay(start)) {
      setError("Нельзя создавать новые события на прошедшие дни. Выберите сегодня или будущую дату.");
      return;
    }
    if (draft.projectId && !draft.workstreamId) {
      setError("Выберите направление связанного проекта.");
      return;
    }
    if (!draft.projectId && (draft.workstreamId || draft.projectItemId)) {
      setError("Сначала выберите проект для связи с направлением или работой.");
      return;
    }
    if (!selected && preparedTasks.some((task) => !task.title.trim())) {
      setError("Укажите название каждой подготовленной внутренней задачи или удалите пустую строку.");
      return;
    }
    const busyChairman = people.find(person => chairmanIds.has(person.id) && busyAttendeeIds.has(person.id) && draft.attendeeIds.includes(person.id));
    if (busyChairman) { warnChairman(busyChairman); return; }
    if (!selected && preparedTasks.some((task) => {
      if (!task.dueAt) return false;
      const dueAt = new Date(task.dueAt).getTime();
      return !Number.isFinite(dueAt) || dueAt <= Date.now();
    })) {
      setError("Укажите для внутренней задачи будущий срок или оставьте поле пустым.");
      return;
    }
    const preparedPaymentAmount = preparedPayment
      ? Number(preparedPayment.amount.replace(/\s/g, ""))
      : undefined;
    if (preparedPayment && !preparedPayment.title.trim()) {
      setError("Укажите название подготовленной заявки на оплату.");
      return;
    }
    if (
      preparedPayment
      && (!Number.isInteger(preparedPaymentAmount) || (preparedPaymentAmount ?? 0) <= 0)
    ) {
      setError("Укажите целую сумму подготовленной заявки больше нуля.");
      return;
    }
    setError("");
    setBusy(true);
    const payload = {
      ...draft,
      // The server expands the audience, including staff absent from an older bootstrap.
      attendeeIds: draft.audienceScope ? [] : draft.attendeeIds,
      title: draft.title.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
    try {
      const isNewEvent = !selected;
      const saved = selected ? await onUpdate(selected, payload) : await onCreate(payload);
      if (!saved) {
        setError(selected ? "Не удалось сохранить событие. Повторите попытку." : "Не удалось создать мероприятие. Повторите попытку.");
      } else {
        const relatedCreationErrors: string[] = [];
        if (isNewEvent && onCreateTask) {
          for (const task of preparedTasks) {
            try {
              const createdTask = await onCreateTask({
                title: task.title.trim(),
                description: task.description.trim() || `Внутренняя задача мероприятия «${saved.title}».`,
                assigneeId: task.assigneeId,
                calendarEventId: saved.id,
                dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : undefined,
                priority: task.priority,
              });
              if (!createdTask) relatedCreationErrors.push(`Задача «${task.title.trim()}» не создана.`);
            } catch (taskError) {
              relatedCreationErrors.push(
                taskError instanceof Error
                  ? `Задача «${task.title.trim()}»: ${taskError.message}`
                  : `Задача «${task.title.trim()}» не создана.`,
              );
            }
          }
        }
        if (isNewEvent && preparedPayment && onCreatePayment && preparedPaymentAmount) {
          try {
            const createdPayment = await onCreatePayment({
              title: preparedPayment.title.trim(),
              amount: preparedPaymentAmount,
              currency: "UZS",
              purpose: saved.title,
              calendarEventId: saved.id,
              projectName: "",
              projectCode: "",
              sourceAccount: "",
              destinationAccount: "",
              requestPriority: "normal",
              comment: `Создано из мероприятия: ${saved.title}`,
              tripPurpose: "",
              employeeIds: saved.attendeeIds,
              projectId: saved.projectId ?? null,
              workstreamId: saved.workstreamId ?? null,
              projectItemId: saved.projectItemId ?? null,
              paymentPurpose: "Мероприятия",
              paymentReason: "",
              responsibleUserId: currentUserId,
            });
            if (!createdPayment) relatedCreationErrors.push("Заявка на оплату не создана.");
          } catch (paymentCreationError) {
            relatedCreationErrors.push(
              paymentCreationError instanceof Error
                ? `Заявка на оплату: ${paymentCreationError.message}`
                : "Заявка на оплату не создана.",
            );
          }
        }
        const savedDate = new Date(saved.startsAt);
        setSelectedDay(startOfDay(savedDate));
        setMonth(new Date(savedDate.getFullYear(), savedDate.getMonth(), 1));
        setSelected(saved);
        setDraft(undefined);
        setPreparedTasks([]);
        setPreparedPayment(undefined);
        if (relatedCreationErrors.length) {
          setError(`Мероприятие создано. ${relatedCreationErrors.join(" ")}`);
        }
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить событие.");
      if (saveError instanceof Error && saveError.message.includes("заняты")) setAvailabilityWarning(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (event: CalendarEvent) => {
    setBusy(true);
    try {
      const changed = await onCancel(event);
      if (changed) setSelected(changed);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Не удалось отменить событие.");
    } finally {
      setBusy(false);
    }
  };

  const respond = async (event: CalendarEvent, status: "accepted" | "declined") => {
    setBusy(true);
    try {
      const changed = await onRespond?.(event, status);
      if (changed) setSelected(changed);
    } catch (responseError) {
      setError(responseError instanceof Error ? responseError.message : "Не удалось сохранить ответ.");
    } finally {
      setBusy(false);
    }
  };

  const openPaymentComposer = (event: CalendarEvent) => {
    setPaymentEvent(event);
    setPaymentTitle(`Оплата: ${event.title}`);
    setPaymentAmount("");
    setPaymentError("");
  };

  const createPayment = async () => {
    if (!paymentEvent || !onCreatePayment) return;
    if (Date.parse(paymentEvent.endsAt) <= Date.now()) {
      setPaymentError("Это событие уже завершилось. Выберите актуальную встречу или мероприятие.");
      return;
    }
    const amount = Number(paymentAmount.replace(/\s/g, ""));
    if (!Number.isInteger(amount) || amount <= 0) {
      setPaymentError("Укажите сумму в сумах целым положительным числом.");
      return;
    }
    setPaymentBusy(true);
    setPaymentError("");
    try {
      const created = await onCreatePayment({
        title: paymentTitle.trim(),
        amount,
        currency: "UZS",
        purpose: paymentEvent.title,
        calendarEventId: paymentEvent.id,
        projectName: "",
        projectCode: "",
        sourceAccount: "",
        destinationAccount: "",
        requestPriority: "normal",
        comment: `Создано из мероприятия: ${paymentEvent.title}`,
        tripPurpose: "",
        employeeIds: paymentEvent.attendeeIds,
        projectId: paymentEvent.projectId ?? null,
        workstreamId: paymentEvent.workstreamId ?? null,
        projectItemId: paymentEvent.projectItemId ?? null,
        paymentPurpose: "Мероприятия",
        paymentReason: "",
        responsibleUserId: currentUserId,
      });
      if (created) setPaymentEvent(undefined);
      else setPaymentError("Не удалось создать заявку. Проверьте права и подключение.");
    } catch (paymentCreateError) {
      setPaymentError(paymentCreateError instanceof Error ? paymentCreateError.message : "Не удалось создать заявку.");
    } finally {
      setPaymentBusy(false);
    }
  };

  const agendaContent = <>
    {error && !selected && !draft ? <WorkspaceNotice tone="error" className="auth-error calendar-error" role="alert">{error}</WorkspaceNotice> : null}
    <div className="calendar-day-panel">
      <div className="calendar-side-heading calendar-day-heading">
        <span>{selectedDayIsPast ? "Прошедший день" : dayKey(selectedDay) === dayKey(new Date()) ? "Сегодня" : "Выбранный день"}</span>
        <h2>{dateLabel(selectedDay, false)}</h2>
        <p>{dateLabel(selectedDay).split(",")[0]}</p>
      </div>
      <div className="calendar-day-summary">
        <span>{selectedDayItems.length}</span><p>записей в расписании</p>
        {!selectedDayIsPast ? <Button disabled={Boolean(draft) || busy} appearance="primary" icon={<Add24Regular />} onClick={() => createForDay(selectedDay)}>Добавить</Button> : null}
      </div>
      {selectedDayIsPast ? <WorkspaceNotice tone="info" className="calendar-past-note">Новые события задним числом недоступны. Уже созданные события можно открыть и изменить.</WorkspaceNotice> : null}
      <div className="calendar-day-agenda">
        {selectedDayItems.length ? <CalendarSchedule items={selectedDayItems} currentUserId={currentUserId} disabled={Boolean(draft) || busy}
          people={people} onEvent={openScheduleEvent} onZoom={openZoomEvent} /> : <div className="calendar-empty">
          <span aria-hidden="true">{selectedDayIsPast ? "✓" : "+"}</span>
          <h3>{hasFilters ? "Нет событий по фильтрам" : selectedDayIsPast ? "День без событий" : "Пока свободно"}</h3>
          <p>{hasFilters ? "Это результат поиска, а не подтверждение свободного времени. Попробуйте изменить фильтры." : selectedDayIsPast ? "На эту дату событий не было." : "Выберите удобное время и добавьте событие."}</p>
          {hasFilters && <Button disabled={Boolean(draft) || busy} onClick={resetFilters}>Сбросить фильтры</Button>}
          {!selectedDayIsPast ? <Button disabled={Boolean(draft) || busy} onClick={() => createForDay(selectedDay)}>Создать событие</Button> : null}
        </div>}
      </div>
    </div>
  </>;
  return (
    <section ref={frameRef} className={`workspace-view calendar-view calendar-ux ${agendaCompact ? "calendar-agenda-compact" : "calendar-agenda-inline"}${agendaDense ? " calendar-agenda-dense" : ""}${view === "list" ? " calendar-tiles-mode" : ""}`} aria-label="Календарь">
        <WorkspaceSectionHeader motif="calendar" className="calendar-toolbar">
          <div className="calendar-title">
            <span>Рабочий календарь</span>
            <h1>Календарь</h1>
            <p>Встречи, мероприятия и Zoom</p>
          </div>
          <div className="calendar-toolbar-actions">
            <Button
              className="ws-section-header-primary"
              appearance="primary"
              icon={<Add24Regular />}
              disabled={Boolean(draft) || busy}
              onClick={() => {
                const today = new Date();
                setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                createForDay(today);
              }}
            >
              Новое событие
            </Button>
          </div>
        </WorkspaceSectionHeader>
      <CalendarFilters value={filters} onChange={changeFilters} onReset={resetFilters}
        people={people} token={token} currentUserId={currentUserId} disabled={Boolean(draft) || busy} compact={agendaCompact} />
      <div className="calendar-main">
        <div className="calendar-view-bar">
          <div className="calendar-view-summary"><h2>{view === "list" && (filters.from || filters.to) ? "Выбранный период" : monthLabel}</h2>
            <span role="status" aria-live="polite">Событий: {(view === "list" ? listItems : monthItems).length}{hasFilters ? " · По выбранным фильтрам" : ""}</span></div>
          <div className="calendar-view-controls">
            <div className="calendar-month-navigation" aria-label="Навигация по месяцам">
              <Button appearance="subtle" icon={<ChevronLeft24Regular />} aria-label="Предыдущий месяц" disabled={Boolean(draft) || busy || (view === "list" && Boolean(filters.from || filters.to))} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
              <Button appearance="subtle" disabled={Boolean(draft) || busy} onClick={goToToday}>Сегодня</Button>
              <Button appearance="subtle" icon={<ChevronRight24Regular />} aria-label="Следующий месяц" disabled={Boolean(draft) || busy || (view === "list" && Boolean(filters.from || filters.to))} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
            </div>
            <WorkspaceDateTimePicker mode="date" dateFormat="numeric" ariaLabel="Перейти к дате" value={dayKey(selectedDay)}
              disabled={Boolean(draft) || busy} onChange={value => { const date = new Date(`${value}T00:00:00`); if (Number.isFinite(date.getTime())) { setFilters(current => ({ ...current, from: "", to: "" })); setView("month"); chooseDay(date); } }} />
          <SlidingSegmented className="calendar-view-switch" aria-label="Вид календаря">
            <button type="button" disabled={Boolean(draft) || busy} aria-pressed={view === "month"} onClick={() => setView("month")}>Месяц</button>
            <button type="button" disabled={Boolean(draft) || busy} aria-pressed={view === "list"} onClick={() => { setView("list"); setAgendaOpen(false); }}>Плитки</button>
          </SlidingSegmented>
          {view === "month" && agendaCompact && <Button {...agendaFocusTarget} className="browser-calendar-agenda" appearance="secondary"
            disabled={Boolean(draft) || busy} aria-haspopup="dialog" aria-expanded={agendaOpen}
            aria-label={`События выбранного дня · ${selectedDayItems.length}`}
            onClick={click => {
              click.currentTarget.focus({ preventScroll: true });
              agendaReturnTarget.current = click.currentTarget;
              setAgendaOpen(true);
            }}>Расписание · {selectedDayItems.length}</Button>}
          </div>
        </div>
        {view === "list" ? <section className="calendar-list-view" aria-label="События по датам">
          {listItems.length ? <><CalendarSchedule items={listItems.slice(0, listLimit)} showDates periodStart={filters.from || (!filters.to ? dayKey(month) : undefined)} currentUserId={currentUserId} disabled={Boolean(draft) || busy}
            people={people} onEvent={openScheduleEvent} onZoom={openZoomEvent} />
            {listItems.length > listLimit && <Button onClick={() => setListLimit(limit => limit + 100)}>Показать ещё · {listItems.length - listLimit}</Button>}</>
            : <div className="calendar-empty"><CalendarIcon iconKey="meeting" /><h3>События не найдены</h3>
                <p>{hasFilters ? "Измените сотрудника, поиск или период. Фильтры не меняют ваше расписание." : "В этом месяце нет доступных событий."}</p>
                {hasFilters && <Button onClick={resetFilters} disabled={Boolean(draft) || busy}>Сбросить фильтры</Button>}</div>}
        </section> :
        <div className="calendar-board">
          <div className="calendar-weekdays" aria-hidden="true">
            {weekdayLabels.map((day) => <span key={day}>{day}</span>)}
          </div>
              <div
            className="calendar-grid"
            key={`${month.getFullYear()}-${month.getMonth()}`}
            role="grid"
            aria-label={monthLabel}
            style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}
          >
            {days.map((day) => {
              const key = dayKey(day);
               const dayItems = calendarItemsOnDay(schedule, day, filters);
               const dayItemCount = dayItems.length;
               const previewCount = agendaDense ? 1 : visibleEventsPerDay;
               const visibleItems = dayItems.slice(0, previewCount);
              const outside = day.getMonth() !== month.getMonth();
              const today = key === dayKey(new Date());
              const active = key === dayKey(selectedDay);
              const past = isPastDay(day);
              const label = dateLabel(day);
              return (
                <div
                  className={`calendar-day ${outside ? "muted" : ""} ${today ? "today" : ""} ${active ? "selected" : ""} ${past ? "past" : ""} ${[0, 6].includes(day.getDay()) ? "weekend" : ""} ${calendarDayInRange(key, filters) ? "" : "outside-filter"}`}
                  data-calendar-day={key}
                  {...agendaFocusTarget}
                  key={key}
                  role="gridcell"
                  tabIndex={0}
                  aria-label={`${label}, событий: ${dayItemCount}`}
                  aria-selected={active}
                  aria-disabled={Boolean(draft) || busy}
                  onClick={click => { if (!draft && !busy) {
                    click.currentTarget.focus({ preventScroll: true });
                    chooseDay(day, true);
                  } }}
                  onKeyDown={(event) => {
                    if (draft || busy) return;
                    if (event.target !== event.currentTarget) return;
                    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
                    if (offset !== undefined) {
                      event.preventDefault();
                      const next = new Date(day); next.setDate(next.getDate() + offset);
                      pendingDayFocus.current = dayKey(next); chooseDay(next); return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      chooseDay(day, true);
                    }
                  }}
                >
                  <div className="calendar-day-header">
                    <span className="calendar-day-number">{day.getDate()}</span>
                    {today ? <span className="calendar-today-label">Сегодня</span> : null}
                    {dayItemCount > previewCount && !agendaCompact ? <button {...agendaFocusTarget} type="button" className="calendar-more-events"
                      title={`Показать все события: ${dayItemCount}`} aria-label={`Все события: ${label}`}
                      disabled={Boolean(draft) || busy} onClick={event => { event.stopPropagation(); chooseDay(day); sideRef.current?.focus({ preventScroll: true }); }}>{agendaDense ? dayItemCount : `+${dayItemCount - previewCount}`}</button>
                      : dayItemCount > 0 ? <span className="calendar-day-count">{dayItemCount}</span> : null}
                  </div>
                  <div className="calendar-day-events">
                    {visibleItems.map((item) => (
                      <button
                        {...eventFocusTarget}
                        className={`calendar-event-pill ${item.kind === "zoom" ? "zoom" : `${item.record.eventType} ${item.record.status}`}`}
                        style={item.kind === "event" ? calendarAppearanceStyle(item.record) : undefined}
                        aria-label={`${item.kind === "event" ? eventTime(item.record) : `Zoom · ${new Date(item.record.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`} · ${item.title}`}
                        title={`${item.title} · ${new Date(item.record.startsAt).toLocaleString("ru-RU")}`}
                        key={item.key}
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          if (draft || busy) return;
                          if (item.kind === "zoom") { openZoomEvent(item.record); return; }
                          setSelectedDay(startOfDay(day));
                          setSelected(item.record);
                          setDraft(undefined);
                          setError("");
                        }}
                      >
                        <span>{item.kind === "event" && item.record.allDay ? "День" : dayKey(new Date(item.record.startsAt)) === key ? new Date(item.record.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "↳"}</span>
                        <CalendarIcon zoom={item.kind === "zoom"} iconKey={item.kind === "event" ? item.record.iconKey : undefined} /><strong>{item.title}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>}
      </div>

      {/* Parent agenda portal precedes the event portal so nested cards remain above it. */}
      <CalendarAgendaDrawer open={agendaCompact && agendaOpen && view === "month"} onClose={() => setAgendaOpen(false)}
        onExited={() => {
          if (agendaCompact && !agendaOpen && agendaReturnTarget.current?.isConnected) {
            agendaReturnTarget.current.focus({ preventScroll: true });
          }
        }}>{agendaContent}</CalendarAgendaDrawer>
      <CalendarEventDialog open={Boolean(selected || selectedZoom)} title={selected?.title ?? selectedZoom?.topic ?? ""} editing={Boolean(draft)} busy={busy}
        onExited={() => {
          // Nested modal exit can leave the parent inactive after pointer dismissal.
          // Restore only after Fluent finishes, without guessing an animation timer.
          if (agendaCompact && agendaOpen && agendaEventReturnTarget.current?.isConnected) {
            agendaEventReturnTarget.current.focus({ preventScroll: true });
          }
        }}
        onClose={() => { if (draft) { closeDraft(); return; } setSelected(undefined); setSelectedZoom(undefined); setError(""); }}>
        {error && selected ? <WorkspaceNotice tone="error" className="auth-error calendar-error" role="alert">{error}</WorkspaceNotice> : null}
        {draft && selected ? (
          <div className="calendar-form">
            <div className="calendar-side-nav">
              <Button appearance="subtle" disabled={busy} icon={<ArrowLeft20Regular />} onClick={closeDraft}>К событию</Button>
            </div>
            <Input aria-label="Название события" placeholder="Название события" value={draft.title} onChange={(_event, data) => setDraft({ ...draft, title: data.value })} />
            <Select aria-label="Тип события" value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value as CalendarEventType })}>
              <option value="meeting">Встреча</option>
              <option value="general">Мероприятие</option>
              {selected.eventType !== "meeting" && selected.eventType !== "general" ? (
                <option value={selected.eventType}>{typeLabels[selected.eventType]}</option>
              ) : null}
            </Select>
            <CalendarAppearance draft={draft} disabled={busy} onChange={setDraft} />
            <div className="calendar-form-dates">
              <label>
                Начало
                <WorkspaceDateTimePicker ariaLabel="Начало события" value={draft.startsAt} min={selected ? undefined : localInput(startOfDay(new Date()))} onChange={(value) => setDraft({ ...draft, startsAt: value })} />
              </label>
              <label>
                Окончание
                <WorkspaceDateTimePicker ariaLabel="Окончание события" value={draft.endsAt} min={draft.startsAt} onChange={(value) => setDraft({ ...draft, endsAt: value })} />
              </label>
            </div>
            <Checkbox checked={draft.allDay} label="Событие на весь день" onChange={(_event, data) => setDraft({ ...draft, allDay: data.checked === true })} />
            <Input aria-label="Место" placeholder="Место или ссылка" value={draft.location} onChange={(_event, data) => setDraft({ ...draft, location: data.value })} />
            <Textarea aria-label="Описание события" placeholder="Описание и детали" value={draft.description} onChange={(_event, data) => setDraft({ ...draft, description: data.value })} />
            {canLinkProjects ? <div>
              <h3>Связь с проектом</h3>
              {projectTargetsLoading ? <p role="status">Загружаем проекты…</p> : null}
              {projectTargetsError ? <WorkspaceNotice tone="error" role="alert" actions={<><Button onClick={() => setProjectTargetsAttempt((value) => value + 1)}>Повторить</Button></>}>{projectTargetsError} </WorkspaceNotice> : null}
              <CalendarProjectLinkFields value={draft} targets={projectTargets} onChange={setDraft} />
            </div> : null}
            <fieldset>
              <legend>Участники</legend>
              {canInviteCalendarAudience ? <CalendarAudienceActions scope={draft.audienceScope}
                count={draft.attendeeIds.length} busy={busy} hasDepartments={Boolean(departments)} onSelect={selectAudience} /> : null}
              {departments ? <EmployeeScopeSwitch value={editAttendeeScope} onChange={setEditAttendeeScope} label="Группа участников события" /> : null}
              {activePeople.filter((person) => !departments || employeeScope(person.departmentId, departments) === editAttendeeScope).map((person) => (
                <Checkbox
                  key={person.id}
                  label={<span className="workspace-person-choice"><Avatar name={person.name} size={24} color="colorful" aria-hidden="true" /><EmployeeProfileLink userId={person.id} personName={person.name}>
                    {person.name}{busyAttendeeIds.has(person.id) ? " · занят" : ""}
                  </EmployeeProfileLink></span>}
                  checked={draft.attendeeIds.includes(person.id)}
                  disabled={busy || (
                    person.id !== currentUserId
                    && busyAttendeeIds.has(person.id)
                    && !chairmanIds.has(person.id)
                    && !draft.attendeeIds.includes(person.id)
                  )}
                  onChange={(_event, data) => {
                    if (data.checked && busyAttendeeIds.has(person.id) && chairmanIds.has(person.id)) { warnChairman(person); return; }
                    setDraft({
                    ...draft,
                    audienceScope: undefined,
                    attendeeIds: data.checked ? [...draft.attendeeIds, person.id] : draft.attendeeIds.filter((id) => id !== person.id),
                    });
                  }}
                />
              ))}
            </fieldset>
            <div className="calendar-form-actions">
              <Button appearance="primary" disabled={busy || !draft.title.trim()} onClick={() => void save()}>
                Сохранить
              </Button>
              <Button appearance="subtle" disabled={busy} onClick={closeDraft}>Отменить</Button>
            </div>
          </div>
        ) : selected ? (
          <div className="calendar-detail">
            <div className="calendar-detail-hero" style={calendarAppearanceStyle(selected)}>
              <CalendarIcon iconKey={selected.iconKey} />
              <span className={`calendar-type ${selected.eventType}`}>{typeLabels[selected.eventType]}</span>
              <p className="calendar-detail-time">{eventTime(selected)}</p>
            </div>
            <dl className="calendar-detail-list">
              <div><dt>Дата</dt><dd>{dateLabel(new Date(selected.startsAt))}</dd></div>
              {selected.location ? <div><dt>Место</dt><dd>{selected.location}</dd></div> : null}
              {selected.projectId && canLinkProjects ? <div><dt>Проект</dt><dd>{projectTargets.projects.find((project) => project.id === selected.projectId)?.title ?? "Связанный проект"}</dd></div> : null}
              {selected.workstreamId && canLinkProjects ? <div><dt>Направление</dt><dd>{projectTargets.workstreams.find((row) => row.id === selected.workstreamId)?.title ?? "Связанное направление"}</dd></div> : null}
              {selected.projectItemId && canLinkProjects ? <div><dt>Работа</dt><dd>{projectTargets.items.find((item) => item.id === selected.projectItemId)?.title ?? "Связанная работа"}</dd></div> : null}
              <div className="calendar-detail-attendees">
                <dt>Участники</dt>
                <dd className="calendar-attendee-list">
                  {selected.attendeeIds.map((id) => {
                    const status = attendanceStatus(selected, id);
                    return (
                      <EmployeeProfileLink key={id} userId={id} personName={people.find((person) => person.id === id)?.name ?? "Сотрудник"} className={`calendar-attendee-status ${status ?? "pending"}`}>
                        {people.find((person) => person.id === id)?.name ?? "Сотрудник"}
                        {status ? ` · ${attendanceLabels[status]}` : ""}
                      </EmployeeProfileLink>
                    );
                  })}
                  {selected.attendeeIds.length === 0 ? "Не указаны" : null}
                </dd>
              </div>
            </dl>
            {selected.description ? <div className="calendar-detail-description"><span>Описание</span><p>{selected.description}</p></div> : null}
            <div className="calendar-linked-records">
              <div className="calendar-linked-records-heading">
                <span>Внутренние задачи</span>
                {selected.canEdit && selected.status === "scheduled" && onCreateTask ? (
                  <Button appearance="secondary" size="small" onClick={() => setTaskComposerEvent(selected)}>+ Внутренняя задача</Button>
                ) : null}
              </div>
              {linkedTasks.length ? linkedTasks.map((task) => (
                <button key={task.id} type="button" className="calendar-linked-task" onClick={() => onOpenTask?.(task.id)}>
                  <strong>{task.title}</strong>
                  <span>{task.status === "completed" ? "Выполнена" : task.dueLabel}</span>
                </button>
              )) : <p>Задач пока нет.</p>}
            </div>
            <div className="calendar-linked-records">
              <div className="calendar-linked-records-heading">
                <span>Заявки на оплату</span>
                {selected.canEdit && selected.status === "scheduled"
                  && ["meeting", "general"].includes(selected.eventType)
                  && Date.parse(selected.endsAt) > calendarNow
                  && canCreatePaymentRequest && onCreatePayment ? (
                  <Button appearance="secondary" size="small" onClick={() => openPaymentComposer(selected)}>+ Заявка на оплату</Button>
                ) : null}
              </div>
              {linkedPayments.length ? linkedPayments.map((request) => (
                <div key={request.id} className="calendar-linked-task calendar-linked-payment">
                  <strong>{request.title}</strong>
                  <span>{request.stageLabel}</span>
                </div>
              )) : <p>Заявок пока нет.</p>}
            </div>
            {selected.status === "cancelled" ? <span className="calendar-cancelled">Событие отменено</span> : null}
            {selected.canEdit && selected.status === "scheduled" ? (
              <div className="calendar-form-actions">
                <Button appearance="primary" disabled={busy} onClick={() => { setError(""); setDraft(editDraft(selected)); }}>Изменить</Button>
                <Button appearance="subtle" disabled={busy} onClick={() => void cancel(selected)}>Отменить событие</Button>
              </div>
            ) : null}
            {selected.canRespond && selected.status === "scheduled" ? (
              <div className="calendar-form-actions" aria-label="Ответ на приглашение">
                <Button appearance="primary" disabled={busy} onClick={() => void respond(selected, "accepted")}>Подтвердить участие</Button>
                <Button appearance="subtle" disabled={busy} onClick={() => void respond(selected, "declined")}>Отказаться</Button>
              </div>
            ) : null}
          </div>
        ) : selectedZoom ? <CalendarZoomDetails meeting={selectedZoom} people={people}
          onOpen={onOpenZoomMeeting ? () => { setSelectedZoom(undefined); onOpenZoomMeeting(selectedZoom.id); } : undefined} /> : null}
      </CalendarEventDialog>
      {!agendaCompact && view === "month" && <aside className="calendar-side" ref={sideRef} tabIndex={-1} aria-label="События выбранного дня">{agendaContent}</aside>}
      {draft && !selected ? <CalendarEventComposer
        draft={draft}
        canInviteCalendarAudience={canInviteCalendarAudience}
        onSelectAudience={selectAudience}
        projectTargets={projectTargets}
        canLinkProjects={canLinkProjects}
        projectTargetsLoading={projectTargetsLoading}
        projectTargetsError={projectTargetsError}
        onRetryProjectTargets={() => setProjectTargetsAttempt((value) => value + 1)}
        people={people}
        departments={departments}
        currentUserId={currentUserId}
        busyAttendeeIds={busyAttendeeIds}
        chairmanIds={chairmanIds}
        onUnavailableChairman={warnChairman}
        minimumStart={localInput(startOfDay(new Date()))}
        tasks={preparedTasks}
        payment={preparedPayment}
        canCreateTask={Boolean(onCreateTask)}
        canCreatePayment={Boolean(canCreatePaymentRequest && onCreatePayment)}
        busy={busy}
        error={error}
        onDraftChange={setDraft}
        onAddTask={addPreparedTask}
        onUpdateTask={updatePreparedTask}
        onRemoveTask={(key) => setPreparedTasks((items) => items.filter((item) => item.key !== key))}
        onPaymentChange={setPreparedPayment}
        onClose={closeDraft}
        onSubmit={save}
      /> : null}
      {availabilityWarning ? <Dialog open onOpenChange={(_, data) => { if (!data.open) setAvailabilityWarning(""); }}>
        <DialogSurface aria-label="Участник уже занят"><DialogBody><DialogTitle>Участник уже занят</DialogTitle>
          <DialogContent>{availabilityWarning}</DialogContent><DialogActions><Button appearance="primary" onClick={() => setAvailabilityWarning("")}>Понятно</Button></DialogActions>
        </DialogBody></DialogSurface>
      </Dialog> : null}
      {taskComposerEvent && onCreateTask ? <TaskComposer
        open
        people={people}
        departments={departments}
        tasks={tasks ?? []}
        currentUserId={currentUserId}
        initialTitle={`Подготовка: ${taskComposerEvent.title}`}
        sourceLabel={`Мероприятие: ${taskComposerEvent.title}`}
        calendarEventId={taskComposerEvent.id}
        onClose={() => setTaskComposerEvent(undefined)}
        onSubmit={async (payload) => {
          const created = await onCreateTask(payload);
          if (created) setTaskComposerEvent(undefined);
          return created;
        }}
      /> : null}
      {paymentEvent && onCreatePayment ? <Dialog open onOpenChange={(_event, data) => {
        if (!data.open && !paymentBusy) setPaymentEvent(undefined);
      }}>
        <DialogSurface className="record-composer-dialog calendar-payment-dialog" aria-labelledby="calendar-payment-title">
          <form className="record-composer" noValidate onSubmit={(event) => { event.preventDefault(); void createPayment(); }}>
            <div className="calendar-side-heading">
              <span>Заявка из мероприятия</span>
              <h2 id="calendar-payment-title">Оплата мероприятия</h2>
              <p>{paymentEvent.title}. После создания статус будет обновляться в этой карточке.</p>
            </div>
            {paymentError ? <WorkspaceNotice tone="error" className="auth-error" role="alert">{paymentError}</WorkspaceNotice> : null}
            <Input aria-label="Название заявки" value={paymentTitle} onChange={(_event, data) => setPaymentTitle(data.value)} />
            <Input aria-label="Сумма заявки в сумах" inputMode="numeric" value={paymentAmount} onChange={(_event, data) => setPaymentAmount(data.value)} placeholder="Сумма в UZS" />
            <div className="calendar-form-actions">
              <Button appearance="primary" type="submit" disabled={paymentBusy || !paymentTitle.trim()}>Создать заявку</Button>
              <Button appearance="subtle" disabled={paymentBusy} onClick={() => setPaymentEvent(undefined)}>Отмена</Button>
            </div>
          </form>
        </DialogSurface>
      </Dialog> : null}
    </section>
  );
}
