import { useState, type FormEvent } from "react";

import type {
  CalendarEventInput,
  WorkspacePerson,
  WorkspaceTask,
} from "@yuksalish/contracts";
import { Button, Checkbox, DialogSurface, Input, Textarea } from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";

import { PersonPicker } from "./PersonPicker";
import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";

export interface PreparedEventTask {
  readonly key: number;
  readonly title: string;
  readonly description: string;
  readonly assigneeId: string;
  readonly dueAt: string;
  readonly priority: WorkspaceTask["priority"];
}

export interface PreparedEventPayment {
  readonly title: string;
  readonly amount: string;
}

interface CalendarEventComposerProps {
  readonly draft: CalendarEventInput;
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly busyAttendeeIds: ReadonlySet<string>;
  readonly minimumStart: string;
  readonly tasks: readonly PreparedEventTask[];
  readonly payment?: PreparedEventPayment;
  readonly canCreateTask: boolean;
  readonly canCreatePayment: boolean;
  readonly busy: boolean;
  readonly error: string;
  readonly onDraftChange: (next: CalendarEventInput) => void;
  readonly onAddTask: () => void;
  readonly onUpdateTask: (key: number, changes: Partial<PreparedEventTask>) => void;
  readonly onRemoveTask: (key: number) => void;
  readonly onPaymentChange: (next?: PreparedEventPayment) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => Promise<void>;
}

const priorityLabels: Readonly<Record<WorkspaceTask["priority"], string>> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
    : "Укажите дату и время";
}

export function CalendarEventComposer({
  draft,
  people,
  currentUserId,
  busyAttendeeIds,
  minimumStart,
  tasks,
  payment,
  canCreateTask,
  canCreatePayment,
  busy,
  error,
  onDraftChange,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onPaymentChange,
  onClose,
  onSubmit,
}: CalendarEventComposerProps) {
  const [attendeeQuery, setAttendeeQuery] = useState("");
  const activePeople = people.filter((person) => !person.status || person.status === "active");
  const normalizedQuery = attendeeQuery.trim().toLocaleLowerCase("ru");
  const visiblePeople = activePeople.filter((person) =>
    `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(normalizedQuery),
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !busy) onClose(); }}>
      <DialogSurface className="record-composer-dialog calendar-event-composer-dialog" aria-labelledby="calendar-event-composer-title">
        <form className="record-composer calendar-event-composer" noValidate aria-busy={busy} onSubmit={submit}>
          <RecordComposer
            title="Новое мероприятие"
            titleId="calendar-event-composer-title"
            eyebrow="Календарь / Создание"
            busy={busy}
            error={error}
            submitLabel="Создать мероприятие"
            submitDisabled={!draft.title.trim()}
            hint="Участники получат приглашение, связанные задачи появятся в карточке мероприятия."
            onClose={onClose}
            aside={(
              <>
                <RecordSummary title="Предварительный просмотр">
                  <div className="calendar-composer-preview">
                    <span>{draft.eventType === "meeting" ? "Встреча" : "Мероприятие"}</span>
                    <strong>{draft.title.trim() || "Название мероприятия"}</strong>
                    <p>{draft.description.trim() || "Добавьте описание, место и участников."}</p>
                    <dl className="record-summary-facts">
                      <div><dt>Начало</dt><dd>{dateTimeLabel(draft.startsAt)}</dd></div>
                      <div><dt>Окончание</dt><dd>{dateTimeLabel(draft.endsAt)}</dd></div>
                      <div><dt>Место</dt><dd>{draft.location.trim() || "Не указано"}</dd></div>
                      <div><dt>Участники</dt><dd>{draft.attendeeIds.length}</dd></div>
                    </dl>
                  </div>
                </RecordSummary>
                <RecordSummary title="Связанная работа">
                  <p>{tasks.length ? `Внутренних задач: ${tasks.length}` : "Внутренних задач пока нет."}</p>
                  <p>{payment ? "Заявка на оплату подготовлена." : "Заявка на оплату не добавлена."}</p>
                </RecordSummary>
              </>
            )}
          >
            <RecordSection title="Детали мероприятия" description="Укажите время, место и цель встречи или мероприятия.">
              <div className="record-field-grid">
                <label className="record-field-wide">
                  <span>Название <b aria-hidden="true">*</b></span>
                  <Input
                    autoFocus
                    aria-label="Название события"
                    maxLength={240}
                    value={draft.title}
                    onChange={(_event, data) => onDraftChange({ ...draft, title: data.value })}
                  />
                </label>
                <label>
                  <span>Тип</span>
                  <Select
                    aria-label="Тип события"
                    value={draft.eventType}
                    onChange={(event) => onDraftChange({ ...draft, eventType: event.target.value as "meeting" | "general" })}
                  >
                    <option value="meeting">Встреча</option>
                    <option value="general">Мероприятие</option>
                  </Select>
                </label>
                <label>
                  <span>Место или ссылка</span>
                  <Input aria-label="Место" value={draft.location} onChange={(_event, data) => onDraftChange({ ...draft, location: data.value })} />
                </label>
                <label>
                  <span>Начало <b aria-hidden="true">*</b></span>
                  <Input type="datetime-local" aria-label="Начало" value={draft.startsAt} min={minimumStart} onChange={(_event, data) => onDraftChange({ ...draft, startsAt: data.value })} />
                </label>
                <label>
                  <span>Окончание <b aria-hidden="true">*</b></span>
                  <Input type="datetime-local" aria-label="Окончание" value={draft.endsAt} onChange={(_event, data) => onDraftChange({ ...draft, endsAt: data.value })} />
                </label>
                <div className="record-field-wide">
                  <Checkbox checked={draft.allDay} label="Событие на весь день" onChange={(_event, data) => onDraftChange({ ...draft, allDay: data.checked === true })} />
                </div>
                <label className="record-field-wide">
                  <span>Описание и детали</span>
                  <Textarea aria-label="Описание события" maxLength={20_000} resize="vertical" value={draft.description} onChange={(_event, data) => onDraftChange({ ...draft, description: data.value })} />
                </label>
              </div>
            </RecordSection>

            <RecordSection title="Участники" description="Занятого в это время коллегу пригласить нельзя.">
              <Input aria-label="Поиск участника" placeholder="Найти коллегу" value={attendeeQuery} onChange={(_event, data) => setAttendeeQuery(data.value)} />
              <div className="calendar-composer-attendees">
                {visiblePeople.map((person) => (
                  <Checkbox
                    key={person.id}
                    label={`${person.name}${person.id === currentUserId ? " · организатор" : busyAttendeeIds.has(person.id) ? " · занят" : ""}`}
                    checked={draft.attendeeIds.includes(person.id)}
                    disabled={person.id === currentUserId || (busyAttendeeIds.has(person.id) && !draft.attendeeIds.includes(person.id))}
                    onChange={(_event, data) => onDraftChange({
                      ...draft,
                      attendeeIds: data.checked
                        ? [...draft.attendeeIds, person.id]
                        : draft.attendeeIds.filter((id) => id !== person.id),
                    })}
                  />
                ))}
                {!visiblePeople.length ? <p>Сотрудники не найдены.</p> : null}
              </div>
            </RecordSection>

            {canCreateTask ? <RecordSection title="Внутренние задачи" description="Назначьте ответственных и отдельные сроки подготовки.">
              <Button type="button" appearance="secondary" icon={<Add20Regular />} onClick={onAddTask}>Добавить задачу</Button>
              {tasks.length ? <div className="calendar-composer-tasks">{tasks.map((task, index) => (
                <div className="calendar-composer-task" key={task.key}>
                  <header>
                    <strong>Задача {index + 1}</strong>
                    <Button type="button" appearance="subtle" size="small" aria-label={`Удалить задачу ${index + 1}`} onClick={() => onRemoveTask(task.key)}>Убрать</Button>
                  </header>
                  <div className="record-field-grid">
                    <label className="record-field-wide">
                      <span>Название <b aria-hidden="true">*</b></span>
                      <Input aria-label={`Название внутренней задачи ${index + 1}`} value={task.title} onChange={(_event, data) => onUpdateTask(task.key, { title: data.value })} />
                    </label>
                    <label>
                      <span>Ответственный</span>
                      <PersonPicker label={`Ответственный за задачу ${index + 1}`} people={activePeople} value={task.assigneeId} onChange={(id) => onUpdateTask(task.key, { assigneeId: id })} disabled={busy} />
                    </label>
                    <label>
                      <span>Срок</span>
                      <Input type="datetime-local" aria-label={`Срок внутренней задачи ${index + 1}`} value={task.dueAt} onChange={(_event, data) => onUpdateTask(task.key, { dueAt: data.value })} />
                    </label>
                    <label>
                      <span>Приоритет</span>
                      <Select aria-label={`Приоритет внутренней задачи ${index + 1}`} value={task.priority} onChange={(event) => onUpdateTask(task.key, { priority: event.target.value as WorkspaceTask["priority"] })}>
                        {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </Select>
                    </label>
                    <label className="record-field-wide">
                      <span>Описание</span>
                      <Textarea aria-label={`Описание внутренней задачи ${index + 1}`} resize="vertical" value={task.description} onChange={(_event, data) => onUpdateTask(task.key, { description: data.value })} />
                    </label>
                  </div>
                </div>
              ))}</div> : <p className="calendar-composer-empty">Задачи можно добавить сейчас или позже из карточки мероприятия.</p>}
            </RecordSection> : null}

            {canCreatePayment ? <RecordSection title="Заявка на оплату" description="При необходимости подготовьте связанную заявку.">
              {!payment ? <Button type="button" appearance="secondary" icon={<Add20Regular />} onClick={() => onPaymentChange({ title: `Оплата: ${draft.title.trim() || "мероприятие"}`, amount: "" })}>Добавить заявку</Button> : (
                <div className="calendar-composer-task">
                  <header><strong>Заявка</strong><Button type="button" appearance="subtle" size="small" onClick={() => onPaymentChange(undefined)}>Убрать</Button></header>
                  <div className="record-field-grid">
                    <label><span>Название</span><Input aria-label="Название подготовленной заявки" value={payment.title} onChange={(_event, data) => onPaymentChange({ ...payment, title: data.value })} /></label>
                    <label><span>Сумма, UZS</span><Input aria-label="Сумма подготовленной заявки в сумах" inputMode="numeric" value={payment.amount} onChange={(_event, data) => onPaymentChange({ ...payment, amount: data.value })} /></label>
                  </div>
                </div>
              )}
            </RecordSection> : null}
          </RecordComposer>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
