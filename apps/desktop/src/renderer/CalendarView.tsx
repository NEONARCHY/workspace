import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CalendarEvent,
  CalendarAttendanceStatus,
  CalendarEventInput,
  CalendarEventType,
  ApprovalRequestSummary,
  WorkspacePerson,
  WorkspaceTask,
  WorkspaceTaskCreateInput,
  ZoomMeeting,
} from "@yuksalish/contracts";
import { Button, Checkbox, DialogSurface, Input, Textarea } from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowLeft20Regular,
  ChevronLeft24Regular,
  ChevronRight24Regular,
  Dismiss20Regular,
} from "@fluentui/react-icons";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { TaskComposer } from "./TaskComposer";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import type { PaymentRequestInput } from "./workspace-api";

interface CalendarViewProps {
  readonly focusEventId?: string;
  readonly createFromChat?: {
    readonly key: string;
    readonly title: string;
    readonly attendeeIds: readonly string[];
  };
  readonly events: readonly CalendarEvent[];
  /** Task deadlines are a read-only calendar layer; editing stays in the task card. */
  readonly tasks?: readonly WorkspaceTask[];
  readonly requests?: readonly ApprovalRequestSummary[];
  readonly onOpenTask?: (taskId: string) => void;
  /** Conferences of the shared Zoom host, shown read-only next to the events. */
  readonly zoomMeetings?: readonly ZoomMeeting[];
  readonly onOpenZoomMeeting?: (meetingId: string) => void;
  readonly people: readonly WorkspacePerson[];
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
  general: "Событие",
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

interface PreparedEventTask {
  readonly key: number;
  readonly title: string;
  readonly assigneeId: string;
}

interface PreparedEventPayment {
  readonly title: string;
  readonly amount: string;
}

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
  };
}

function editDraft(event: CalendarEvent): CalendarEventInput {
  return {
    title: event.title,
    description: event.description,
    eventType: event.eventType,
    startsAt: localInput(new Date(event.startsAt)),
    endsAt: localInput(new Date(event.endsAt)),
    allDay: event.allDay,
    location: event.location,
    attendeeIds: event.attendeeIds,
  };
}

export function CalendarView({
  focusEventId,
  createFromChat,
  events,
  tasks,
  requests,
  onOpenTask,
  zoomMeetings,
  onOpenZoomMeeting,
  people,
  currentUserId,
  onCreate,
  onUpdate,
  onCancel,
  onCreateTask,
  canCreatePaymentRequest,
  onCreatePayment,
  onRespond,
}: CalendarViewProps) {
  const focusedEvent = events.find((event) => event.id === focusEventId);
  const focusedDate = focusedEvent ? new Date(focusedEvent.startsAt) : new Date();
  const initialDate = Number.isFinite(focusedDate.getTime()) ? focusedDate : new Date();
  const [month, setMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(initialDate));
  const [selectedState, setSelected] = useState<CalendarEvent | undefined>(focusedEvent);
  const [draft, setDraft] = useState<CalendarEventInput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month);
  const selected = events.find((item) => item.id === selectedState?.id) ?? selectedState;
  const selectedDayIsPast = isPastDay(selectedDay);

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const start = new Date(event.startsAt);
      const end = new Date(event.endsAt);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      const lastActiveDay = startOfDay(new Date(end.getTime() - 1));
      const cursor = startOfDay(start);
      for (let dayOffset = 0; cursor <= lastActiveDay && dayOffset < 370; dayOffset += 1) {
        const key = dayKey(cursor);
        const bucket = grouped.get(key) ?? [];
        bucket.push(event);
        grouped.set(key, bucket);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => {
        if (left.status !== right.status) return left.status === "cancelled" ? 1 : -1;
        return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
      });
    }
    return grouped;
  }, [events]);

  const zoomByDay = useMemo(() => {
    const grouped = new Map<string, ZoomMeeting[]>();
    for (const meeting of zoomMeetings ?? []) {
      if (meeting.status !== "scheduled") continue;
      const start = new Date(meeting.startsAt);
      if (!Number.isFinite(start.getTime())) continue;
      const key = dayKey(start);
      grouped.set(key, [...(grouped.get(key) ?? []), meeting]);
    }
    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
    }
    return grouped;
  }, [zoomMeetings]);
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, WorkspaceTask[]>();
    for (const task of tasks ?? []) {
      if (!task.dueAt) continue;
      const dueAt = new Date(task.dueAt);
      if (!Number.isFinite(dueAt.getTime())) continue;
      const key = dayKey(dueAt);
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => new Date(left.dueAt ?? 0).getTime() - new Date(right.dueAt ?? 0).getTime());
    }
    return grouped;
  }, [tasks]);

  const selectedDayEvents = eventsByDay.get(dayKey(selectedDay)) ?? [];
  const selectedDayZoom = zoomByDay.get(dayKey(selectedDay)) ?? [];
  const selectedDayTasks = tasksByDay.get(dayKey(selectedDay)) ?? [];
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
        if (attendee.status !== "declined") busyIds.add(attendee.userId);
      }
    }
    return busyIds;
  }, [draft, events, selected?.id]);
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
    if (draft || selected?.id) sideRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [draft, selected?.id]);

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

  const chooseDay = (day: Date) => {
    setSelectedDay(startOfDay(day));
    setSelected(undefined);
    setDraft(undefined);
    setPreparedTasks([]);
    setPreparedPayment(undefined);
    setError("");
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
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    chooseDay(today);
  };

  const addPreparedTask = () => {
    setPreparedTasks((items) => [
      ...items,
      { key: nextPreparedTaskKey.current++, title: "", assigneeId: currentUserId },
    ]);
  };

  const updatePreparedTask = (key: number, changes: Partial<PreparedEventTask>) => {
    setPreparedTasks((items) => items.map((item) => (
      item.key === key ? { ...item, ...changes } : item
    )));
  };

  const closeDraft = () => {
    setDraft(undefined);
    if (!selected) {
      setPreparedTasks([]);
      setPreparedPayment(undefined);
    }
  };

  const save = async () => {
    if (!draft?.title.trim()) return;
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
    if (!selected && preparedTasks.some((task) => !task.title.trim())) {
      setError("Укажите название каждой подготовленной внутренней задачи или удалите пустую строку.");
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
      title: draft.title.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
    try {
      const isNewEvent = !selected;
      const saved = selected ? await onUpdate(selected, payload) : await onCreate(payload);
      if (saved) {
        const relatedCreationErrors: string[] = [];
        if (isNewEvent && onCreateTask) {
          for (const task of preparedTasks) {
            try {
              const createdTask = await onCreateTask({
                title: task.title.trim(),
                description: `Внутренняя задача мероприятия «${saved.title}».`,
                assigneeId: task.assigneeId,
                calendarEventId: saved.id,
                dueAt: saved.endsAt,
                priority: "normal",
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
              paymentPurpose: "Мероприятия",
              paymentReason: saved.title,
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
        paymentPurpose: "Мероприятия",
        paymentReason: paymentEvent.title,
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

  return (
    <section className="workspace-view calendar-view" aria-label="Календарь">
      <div className="calendar-main">
        <header className="calendar-toolbar">
          <div className="calendar-title">
            <span>Рабочий календарь</span>
            <h1>Календарь</h1>
            <p>{monthLabel}</p>
          </div>
          <div className="calendar-toolbar-actions">
            <div className="calendar-month-navigation" aria-label="Навигация по месяцам">
              <Button appearance="subtle" icon={<ChevronLeft24Regular />} aria-label="Предыдущий месяц" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
              <Button appearance="subtle" onClick={goToToday}>Сегодня</Button>
              <Button appearance="subtle" icon={<ChevronRight24Regular />} aria-label="Следующий месяц" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
            </div>
            <Button
              appearance="primary"
              icon={<Add24Regular />}
              onClick={() => {
                const today = new Date();
                setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                createForDay(today);
              }}
            >
              Новое событие
            </Button>
          </div>
        </header>

        <div className="calendar-board">
          <div className="calendar-weekdays" aria-hidden="true">
            {weekdayLabels.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div
            className="calendar-grid"
            role="grid"
            aria-label={monthLabel}
            style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}
          >
            {days.map((day) => {
              const key = dayKey(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const dayZoom = zoomByDay.get(key) ?? [];
              const dayTasks = tasksByDay.get(key) ?? [];
              const dayItemCount = dayEvents.length + dayZoom.length + dayTasks.length;
              const visibleEvents = dayEvents.slice(0, visibleEventsPerDay);
              const zoomBudget = Math.max(0, visibleEventsPerDay - visibleEvents.length);
              const visibleZoom = dayZoom.slice(0, zoomBudget);
              const taskBudget = Math.max(
                0,
                visibleEventsPerDay - visibleEvents.length - visibleZoom.length,
              );
              const visibleTasks = dayTasks.slice(0, taskBudget);
              const outside = day.getMonth() !== month.getMonth();
              const today = key === dayKey(new Date());
              const active = key === dayKey(selectedDay);
              const past = isPastDay(day);
              const label = dateLabel(day);
              return (
                <div
                  className={`calendar-day ${outside ? "muted" : ""} ${today ? "today" : ""} ${active ? "selected" : ""} ${past ? "past" : ""}`}
                  key={key}
                  role="gridcell"
                  tabIndex={0}
                  aria-label={`${label}, событий: ${dayItemCount}`}
                  aria-selected={active}
                  onClick={() => chooseDay(day)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      chooseDay(day);
                    }
                  }}
                >
                  <div className="calendar-day-header">
                    <span className="calendar-day-number">{day.getDate()}</span>
                    {today ? <span className="calendar-today-label">Сегодня</span> : null}
                    {dayItemCount > 0 ? <span className="calendar-day-count">{dayItemCount}</span> : null}
                  </div>
                  <div className="calendar-day-events">
                    {visibleEvents.map((event) => (
                      <button
                        className={`calendar-event-pill ${event.eventType} ${event.status}`}
                        key={event.id}
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          setSelectedDay(startOfDay(day));
                          setSelected(event);
                          setDraft(undefined);
                          setError("");
                        }}
                      >
                        <span>{event.allDay ? "День" : dayKey(new Date(event.startsAt)) === key ? new Date(event.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "↳"}</span>
                        <strong>{event.title}</strong>
                      </button>
                    ))}
                    {visibleZoom.map((meeting) => (
                      <button
                        className="calendar-event-pill zoom"
                        key={meeting.id}
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          onOpenZoomMeeting?.(meeting.id);
                        }}
                      >
                        <span>{new Date(meeting.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                        <strong>{meeting.topic}</strong>
                      </button>
                    ))}
                    {visibleTasks.map((task) => (
                      <button
                        className={`calendar-event-pill task status-${task.status}`}
                        key={task.id}
                        type="button"
                        aria-label={`Открыть задачу: ${task.title}`}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          onOpenTask?.(task.id);
                        }}
                      >
                        <span>{new Date(task.dueAt ?? 0).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                        <strong>{task.title}</strong>
                      </button>
                    ))}
                    {dayItemCount > visibleEventsPerDay ? <span className="calendar-more-events">Ещё {dayItemCount - visibleEventsPerDay}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="calendar-side" ref={sideRef} aria-label="События выбранного дня">
        {error ? <div className="auth-error calendar-error" role="alert">{error}</div> : null}
        {draft ? (
          <div className={`calendar-form${selected ? "" : " calendar-create-card"}`}>
            <div className="calendar-side-nav">
              <Button appearance="subtle" icon={<ArrowLeft20Regular />} onClick={closeDraft}>{selected ? "К событию" : "К событиям дня"}</Button>
              <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть форму" onClick={closeDraft} />
            </div>
            <div className="calendar-side-heading">
              <span>{selected ? "Редактирование" : "Новое событие"}</span>
              <h2>{selected ? selected.title : dateLabel(selectedDay, false)}</h2>
              {!selected ? <p>Запланируйте встречу, задачу или важный срок.</p> : null}
            </div>
            <Input aria-label="Название события" placeholder="Название события" value={draft.title} onChange={(_event, data) => setDraft({ ...draft, title: data.value })} />
            <Select aria-label="Тип события" value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value as CalendarEventType })}>
              {Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
            <div className="calendar-form-dates">
              <label>
                Начало
                <Input type="datetime-local" value={draft.startsAt} min={selected ? undefined : localInput(startOfDay(new Date()))} onChange={(_event, data) => setDraft({ ...draft, startsAt: data.value })} />
              </label>
              <label>
                Окончание
                <Input type="datetime-local" value={draft.endsAt} onChange={(_event, data) => setDraft({ ...draft, endsAt: data.value })} />
              </label>
            </div>
            <Checkbox checked={draft.allDay} label="Событие на весь день" onChange={(_event, data) => setDraft({ ...draft, allDay: data.checked === true })} />
            <Input aria-label="Место" placeholder="Место или ссылка" value={draft.location} onChange={(_event, data) => setDraft({ ...draft, location: data.value })} />
            <Textarea aria-label="Описание события" placeholder="Описание и детали" value={draft.description} onChange={(_event, data) => setDraft({ ...draft, description: data.value })} />
            <fieldset>
              <legend>Участники</legend>
              {people.map((person) => (
                <Checkbox
                  key={person.id}
                  label={`${person.name}${busyAttendeeIds.has(person.id) ? " · занят" : ""}`}
                  checked={draft.attendeeIds.includes(person.id)}
                  disabled={
                    person.id !== currentUserId
                    && busyAttendeeIds.has(person.id)
                    && !draft.attendeeIds.includes(person.id)
                  }
                  onChange={(_event, data) => setDraft({
                    ...draft,
                    attendeeIds: data.checked ? [...draft.attendeeIds, person.id] : draft.attendeeIds.filter((id) => id !== person.id),
                  })}
                />
              ))}
            </fieldset>
            {!selected ? (
              <section className="calendar-create-links" aria-labelledby="calendar-create-links-title">
                <div className="calendar-create-links-heading">
                  <div>
                    <span>Связанные объекты</span>
                    <h3 id="calendar-create-links-title">Подготовьте работу по мероприятию</h3>
                  </div>
                  <p>Они появятся сразу после создания мероприятия.</p>
                </div>
                {onCreateTask ? (
                  <div className="calendar-create-link-group">
                    <div className="calendar-create-link-group-heading">
                      <span>Внутренние задачи</span>
                      <Button appearance="secondary" size="small" onClick={addPreparedTask}>+ Добавить задачу</Button>
                    </div>
                    {preparedTasks.length ? preparedTasks.map((task, index) => (
                      <div className="calendar-prepared-link" key={task.key}>
                        <div className="calendar-prepared-link-heading">
                          <span>Задача {index + 1}</span>
                          <Button
                            appearance="subtle"
                            size="small"
                            aria-label={`Удалить задачу ${index + 1}`}
                            onClick={() => setPreparedTasks((items) => items.filter((item) => item.key !== task.key))}
                          >
                            Убрать
                          </Button>
                        </div>
                        <Input
                          aria-label={`Название внутренней задачи ${index + 1}`}
                          placeholder="Что нужно сделать"
                          value={task.title}
                          onChange={(_event, data) => updatePreparedTask(task.key, { title: data.value })}
                        />
                        <Select
                          aria-label={`Ответственный за задачу ${index + 1}`}
                          value={task.assigneeId}
                          onChange={(event) => updatePreparedTask(task.key, { assigneeId: event.target.value })}
                        >
                          {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                        </Select>
                      </div>
                    )) : <p className="calendar-create-link-empty">Без задач. Их также можно добавить из карточки мероприятия.</p>}
                  </div>
                ) : null}
                {canCreatePaymentRequest && onCreatePayment ? (
                  <div className="calendar-create-link-group">
                    <div className="calendar-create-link-group-heading">
                      <span>Заявка на оплату</span>
                      {!preparedPayment ? (
                        <Button
                          appearance="secondary"
                          size="small"
                          onClick={() => setPreparedPayment({
                            title: `Оплата: ${draft.title.trim() || "мероприятие"}`,
                            amount: "",
                          })}
                        >
                          + Добавить заявку
                        </Button>
                      ) : null}
                    </div>
                    {preparedPayment ? (
                      <div className="calendar-prepared-link">
                        <div className="calendar-prepared-link-heading">
                          <span>Черновик заявки</span>
                          <Button appearance="subtle" size="small" onClick={() => setPreparedPayment(undefined)}>Убрать</Button>
                        </div>
                        <Input
                          aria-label="Название подготовленной заявки"
                          value={preparedPayment.title}
                          onChange={(_event, data) => setPreparedPayment({ ...preparedPayment, title: data.value })}
                        />
                        <Input
                          aria-label="Сумма подготовленной заявки в сумах"
                          inputMode="numeric"
                          placeholder="Сумма в UZS"
                          value={preparedPayment.amount}
                          onChange={(_event, data) => setPreparedPayment({ ...preparedPayment, amount: data.value })}
                        />
                      </div>
                    ) : <p className="calendar-create-link-empty">Без заявки. После создания её можно добавить в карточке мероприятия.</p>}
                  </div>
                ) : null}
              </section>
            ) : null}
            <div className="calendar-form-actions">
              <Button appearance="primary" disabled={busy || !draft.title.trim()} onClick={() => void save()}>
                {selected ? "Сохранить" : "Создать мероприятие"}
              </Button>
              <Button appearance="subtle" disabled={busy} onClick={closeDraft}>Отменить</Button>
            </div>
          </div>
        ) : selected ? (
          <div className="calendar-detail">
            <div className="calendar-side-nav">
              <Button appearance="subtle" icon={<ArrowLeft20Regular />} onClick={() => setSelected(undefined)}>К событиям дня</Button>
              <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть событие" onClick={() => setSelected(undefined)} />
            </div>
            <div className="calendar-detail-hero">
              <span className={`calendar-type ${selected.eventType}`}>{typeLabels[selected.eventType]}</span>
              <h2>{selected.title}</h2>
              <p className="calendar-detail-time">{eventTime(selected)}</p>
            </div>
            <dl className="calendar-detail-list">
              <div><dt>Дата</dt><dd>{dateLabel(new Date(selected.startsAt))}</dd></div>
              {selected.location ? <div><dt>Место</dt><dd>{selected.location}</dd></div> : null}
              <div>
                <dt>Участники</dt>
                <dd className="calendar-attendee-list">
                  {selected.attendeeIds.map((id) => {
                    const status = attendanceStatus(selected, id);
                    return (
                      <span key={id} className={`calendar-attendee-status ${status ?? "pending"}`}>
                        {people.find((person) => person.id === id)?.name ?? "Сотрудник"}
                        {status ? ` · ${attendanceLabels[status]}` : ""}
                      </span>
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
                {selected.canEdit && selected.status === "scheduled" && canCreatePaymentRequest && onCreatePayment ? (
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
                <Button appearance="primary" onClick={() => { setError(""); setDraft(editDraft(selected)); }}>Изменить</Button>
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
        ) : (
          <div className="calendar-day-panel">
            <div className="calendar-side-heading calendar-day-heading">
              <span>{selectedDayIsPast ? "Прошедший день" : dayKey(selectedDay) === dayKey(new Date()) ? "Сегодня" : "Выбранный день"}</span>
              <h2>{dateLabel(selectedDay, false)}</h2>
              <p>{dateLabel(selectedDay).split(",")[0]}</p>
            </div>
            <div className="calendar-day-summary">
              <span>{selectedDayEvents.length + selectedDayZoom.length + selectedDayTasks.length}</span>
              <p>записей в расписании</p>
              {!selectedDayIsPast ? <Button appearance="primary" icon={<Add24Regular />} onClick={() => createForDay(selectedDay)}>Добавить</Button> : null}
            </div>
            {selectedDayIsPast ? <div className="calendar-past-note">Новые события задним числом недоступны. Уже созданные события можно открыть и изменить.</div> : null}
            <div className="calendar-day-agenda">
              {selectedDayZoom.map((meeting) => (
                <button
                  className="calendar-agenda-card zoom"
                  key={meeting.id}
                  type="button"
                  onClick={() => onOpenZoomMeeting?.(meeting.id)}
                >
                  <span className="calendar-agenda-time">
                    {new Date(meeting.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <strong>{meeting.topic}</strong>
                  <small>Zoom-конференция · {meeting.organizerName}</small>
                </button>
              ))}
              {selectedDayTasks.map((task) => (
                <button
                  className={`calendar-agenda-card task status-${task.status}`}
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask?.(task.id)}
                >
                  <span className="calendar-agenda-time">
                    {new Date(task.dueAt ?? 0).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <strong>{task.title}</strong>
                  <small>Срок задачи · {task.project || "Без проекта"}</small>
                </button>
              ))}
              {selectedDayEvents.length > 0 ? selectedDayEvents.map((event) => (
                <button className={`calendar-agenda-card ${event.eventType} ${event.status}`} key={event.id} type="button" onClick={() => { setSelected(event); setError(""); }}>
                  <span className="calendar-agenda-time">{eventTime(event)}</span>
                  <strong>{event.title}</strong>
                  <small>{typeLabels[event.eventType]}{event.location ? ` · ${event.location}` : ""}</small>
                  {event.status === "cancelled" ? <em>Отменено</em> : null}
                </button>
              )) : selectedDayZoom.length > 0 || selectedDayTasks.length > 0 ? null : (
                <div className="calendar-empty">
                  <span aria-hidden="true">{selectedDayIsPast ? "✓" : "+"}</span>
                  <h3>{selectedDayIsPast ? "День без событий" : "Пока свободно"}</h3>
                  <p>{selectedDayIsPast ? "На эту дату событий не было." : "Выберите удобное время и добавьте событие."}</p>
                  {!selectedDayIsPast ? <Button onClick={() => createForDay(selectedDay)}>Создать событие</Button> : null}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
      {taskComposerEvent && onCreateTask ? <TaskComposer
        open
        people={people}
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
            {paymentError ? <div className="auth-error" role="alert">{paymentError}</div> : null}
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
