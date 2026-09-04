import { useMemo, useState } from "react";

import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventType,
  WorkspacePerson,
} from "@yuksalish/contracts";
import { Button, Checkbox, Input, Select, Textarea } from "@fluentui/react-components";
import { Add24Regular, ChevronLeft24Regular, ChevronRight24Regular } from "@fluentui/react-icons";

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

function localInput(value: Date): string {
  const adjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
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
  const [month, setMonth] = useState(() => {
    const focused = events.find((event) => event.id === focusEventId);
    const value = focused ? new Date(focused.startsAt) : new Date();
    return new Date(value.getFullYear(), value.getMonth(), 1);
  });
  const [selectedState, setSelected] = useState<CalendarEvent | undefined>(
    () => events.find((event) => event.id === focusEventId),
  );
  const [draft, setDraft] = useState<CalendarEventInput>();
  const [busy, setBusy] = useState(false);
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month);

  const selected = events.find((item) => item.id === selectedState?.id) ?? selectedState;

  const days = useMemo(() => {
    const firstWeekday = (month.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_unused, index) => {
      const day = index - firstWeekday + 1;
      return new Date(month.getFullYear(), month.getMonth(), day);
    });
  }, [month]);

  const eventsForDay = (day: Date) => events.filter((event) => {
    const start = new Date(event.startsAt);
    return start.getFullYear() === day.getFullYear()
      && start.getMonth() === day.getMonth()
      && start.getDate() === day.getDate();
  });

  const save = async () => {
    if (!draft?.title.trim() || new Date(draft.endsAt) <= new Date(draft.startsAt)) return;
    setBusy(true);
    const payload = {
      ...draft,
      title: draft.title.trim(),
      startsAt: new Date(draft.startsAt).toISOString(),
      endsAt: new Date(draft.endsAt).toISOString(),
    };
    try {
      const saved = selected ? await onUpdate(selected, payload) : await onCreate(payload);
      if (saved) {
        setSelected(saved);
        setDraft(undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (event: CalendarEvent) => {
    setBusy(true);
    try {
      const changed = await onCancel(event);
      if (changed) setSelected(changed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workspace-view calendar-view" aria-label="Календарь">
      <div className="calendar-main">
        <header className="calendar-toolbar">
          <div>
            <h1>Календарь</h1>
            <p>{monthLabel}</p>
          </div>
          <div>
            <Button
              appearance="subtle"
              icon={<ChevronLeft24Regular />}
              aria-label="Предыдущий месяц"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            />
            <Button appearance="subtle" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
              Сегодня
            </Button>
            <Button
              appearance="subtle"
              icon={<ChevronRight24Regular />}
              aria-label="Следующий месяц"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            />
            <Button
              appearance="primary"
              icon={<Add24Regular />}
              onClick={() => {
                setSelected(undefined);
                setDraft(emptyDraft(currentUserId));
              }}
            >
              Новое событие
            </Button>
          </div>
        </header>
        <div className="calendar-weekdays">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-grid">
          {days.map((day) => (
            <button
              className={`calendar-day ${day.getMonth() !== month.getMonth() ? "muted" : ""}`}
              key={day.toISOString()}
              type="button"
              onDoubleClick={() => {
                setSelected(undefined);
                setDraft(emptyDraft(currentUserId, day));
              }}
            >
              <strong>{day.getDate()}</strong>
              {eventsForDay(day).slice(0, 3).map((event) => (
                <span
                  className={`calendar-event-pill ${event.eventType} ${event.status}`}
                  key={event.id}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    setSelected(event);
                    setDraft(undefined);
                  }}
                >
                  {event.allDay ? "" : `${new Date(event.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} `}
                  {event.title}
                </span>
              ))}
            </button>
          ))}
        </div>
      </div>
      <aside className="calendar-side">
        {draft ? (
          <div className="calendar-form">
            <h2>{selected ? "Изменить событие" : "Новое событие"}</h2>
            <Input aria-label="Название события" placeholder="Название" value={draft.title} onChange={(_e, data) => setDraft({ ...draft, title: data.value })} />
            <Select aria-label="Тип события" value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value as CalendarEventType })}>
              {Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
            <label>Начало<Input type="datetime-local" value={draft.startsAt} onChange={(_e, data) => setDraft({ ...draft, startsAt: data.value })} /></label>
            <label>Окончание<Input type="datetime-local" value={draft.endsAt} onChange={(_e, data) => setDraft({ ...draft, endsAt: data.value })} /></label>
            <Checkbox checked={draft.allDay} label="Весь день" onChange={(_e, data) => setDraft({ ...draft, allDay: data.checked === true })} />
            <Input aria-label="Место" placeholder="Место" value={draft.location} onChange={(_e, data) => setDraft({ ...draft, location: data.value })} />
            <Textarea aria-label="Описание события" placeholder="Описание" value={draft.description} onChange={(_e, data) => setDraft({ ...draft, description: data.value })} />
            <fieldset>
              <legend>Участники</legend>
              {people.map((person) => (
                <Checkbox
                  key={person.id}
                  label={person.name}
                  checked={draft.attendeeIds.includes(person.id)}
                  onChange={(_e, data) => setDraft({
                    ...draft,
                    attendeeIds: data.checked
                      ? [...draft.attendeeIds, person.id]
                      : draft.attendeeIds.filter((id) => id !== person.id),
                  })}
                />
              ))}
            </fieldset>
            <div className="calendar-form-actions">
              <Button appearance="primary" disabled={busy || !draft.title.trim()} onClick={() => void save()}>Сохранить</Button>
              <Button appearance="subtle" onClick={() => setDraft(undefined)}>Отмена</Button>
            </div>
          </div>
        ) : selected ? (
          <div className="calendar-detail">
            <span className={`calendar-type ${selected.eventType}`}>{typeLabels[selected.eventType]}</span>
            <h2>{selected.title}</h2>
            <p>{new Date(selected.startsAt).toLocaleString("ru-RU")} — {new Date(selected.endsAt).toLocaleString("ru-RU")}</p>
            {selected.location ? <p><strong>Место:</strong> {selected.location}</p> : null}
            {selected.description ? <p>{selected.description}</p> : null}
            <p><strong>Участники:</strong> {selected.attendeeIds.map((id) => people.find((person) => person.id === id)?.name).filter(Boolean).join(", ") || "не указаны"}</p>
            {selected.status === "cancelled" ? <span className="calendar-cancelled">Событие отменено</span> : null}
            {selected.canEdit && selected.status === "scheduled" ? (
              <div className="calendar-form-actions">
                <Button onClick={() => setDraft(editDraft(selected))}>Изменить</Button>
                <Button appearance="subtle" disabled={busy} onClick={() => void cancel(selected)}>Отменить событие</Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="calendar-empty">
            <h2>Выберите событие</h2>
            <p>Двойной щелчок по дню создаёт событие сразу на выбранную дату.</p>
          </div>
        )}
      </aside>
    </section>
  );
}
