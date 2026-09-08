import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventType,
  WorkspacePerson,
} from "@yuksalish/contracts";
import { Button, Checkbox, Input, Select, Textarea } from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowLeft20Regular,
  ChevronLeft24Regular,
  ChevronRight24Regular,
  Dismiss20Regular,
} from "@fluentui/react-icons";

interface CalendarViewProps {
  readonly focusEventId?: string;
  readonly events: readonly CalendarEvent[];
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly onCreate: (payload: CalendarEventInput) => Promise<CalendarEvent | undefined>;
  readonly onUpdate: (
    event: CalendarEvent,
    payload: CalendarEventInput,
  ) => Promise<CalendarEvent | undefined>;
  readonly onCancel: (event: CalendarEvent) => Promise<CalendarEvent | undefined>;
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
  events,
  people,
  currentUserId,
  onCreate,
  onUpdate,
  onCancel,
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

  const selectedDayEvents = eventsByDay.get(dayKey(selectedDay)) ?? [];
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

  const chooseDay = (day: Date) => {
    setSelectedDay(startOfDay(day));
    setSelected(undefined);
    setDraft(undefined);
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
    setError("");
  };

  const goToToday = () => {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    chooseDay(today);
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
    setError("");
    setBusy(true);
    const payload = {
      ...draft,
      title: draft.title.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
    try {
      const saved = selected ? await onUpdate(selected, payload) : await onCreate(payload);
      if (saved) {
        const savedDate = new Date(saved.startsAt);
        setSelectedDay(startOfDay(savedDate));
        setMonth(new Date(savedDate.getFullYear(), savedDate.getMonth(), 1));
        setSelected(saved);
        setDraft(undefined);
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
                  aria-label={`${label}, событий: ${dayEvents.length}`}
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
                    {dayEvents.length > 0 ? <span className="calendar-day-count">{dayEvents.length}</span> : null}
                  </div>
                  <div className="calendar-day-events">
                    {dayEvents.slice(0, visibleEventsPerDay).map((event) => (
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
                    {dayEvents.length > visibleEventsPerDay ? <span className="calendar-more-events">Ещё {dayEvents.length - visibleEventsPerDay}</span> : null}
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
          <div className="calendar-form">
            <div className="calendar-side-nav">
              <Button appearance="subtle" icon={<ArrowLeft20Regular />} onClick={() => setDraft(undefined)}>{selected ? "К событию" : "К событиям дня"}</Button>
              <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть форму" onClick={() => setDraft(undefined)} />
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
                  label={person.name}
                  checked={draft.attendeeIds.includes(person.id)}
                  onChange={(_event, data) => setDraft({
                    ...draft,
                    attendeeIds: data.checked ? [...draft.attendeeIds, person.id] : draft.attendeeIds.filter((id) => id !== person.id),
                  })}
                />
              ))}
            </fieldset>
            <div className="calendar-form-actions">
              <Button appearance="primary" disabled={busy || !draft.title.trim()} onClick={() => void save()}>Сохранить</Button>
              <Button appearance="subtle" disabled={busy} onClick={() => setDraft(undefined)}>Отменить</Button>
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
              <div><dt>Участники</dt><dd>{selected.attendeeIds.map((id) => people.find((person) => person.id === id)?.name).filter(Boolean).join(", ") || "Не указаны"}</dd></div>
            </dl>
            {selected.description ? <div className="calendar-detail-description"><span>Описание</span><p>{selected.description}</p></div> : null}
            {selected.status === "cancelled" ? <span className="calendar-cancelled">Событие отменено</span> : null}
            {selected.canEdit && selected.status === "scheduled" ? (
              <div className="calendar-form-actions">
                <Button appearance="primary" onClick={() => { setError(""); setDraft(editDraft(selected)); }}>Изменить</Button>
                <Button appearance="subtle" disabled={busy} onClick={() => void cancel(selected)}>Отменить событие</Button>
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
              <span>{selectedDayEvents.length}</span>
              <p>{selectedDayEvents.length === 1 ? "событие" : selectedDayEvents.length > 1 && selectedDayEvents.length < 5 ? "события" : "событий"}</p>
              {!selectedDayIsPast ? <Button appearance="primary" icon={<Add24Regular />} onClick={() => createForDay(selectedDay)}>Добавить</Button> : null}
            </div>
            {selectedDayIsPast ? <div className="calendar-past-note">Новые события задним числом недоступны. Уже созданные события можно открыть и изменить.</div> : null}
            <div className="calendar-day-agenda">
              {selectedDayEvents.length > 0 ? selectedDayEvents.map((event) => (
                <button className={`calendar-agenda-card ${event.eventType} ${event.status}`} key={event.id} type="button" onClick={() => { setSelected(event); setError(""); }}>
                  <span className="calendar-agenda-time">{eventTime(event)}</span>
                  <strong>{event.title}</strong>
                  <small>{typeLabels[event.eventType]}{event.location ? ` · ${event.location}` : ""}</small>
                  {event.status === "cancelled" ? <em>Отменено</em> : null}
                </button>
              )) : (
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
    </section>
  );
}
