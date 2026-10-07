import { useState } from "react";
import { Input } from "@fluentui/react-components";

import type { CalendarEvent, PaymentProjectTargets } from "@yuksalish/contracts";

import { WorkspaceSelect } from "./WorkspaceSelect";
import { useCalendarEventClock } from "./useCalendarEventClock";

interface PaymentCalendarEventPickerProps {
  readonly events: readonly CalendarEvent[];
  readonly projects: PaymentProjectTargets["projects"];
  readonly projectId: string;
  readonly selectedEventId: string;
  readonly revision?: boolean;
  readonly onSelect: (eventId: string, event?: CalendarEvent) => void;
}

function localDateKey(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventLabel(event: CalendarEvent, projects: PaymentProjectTargets["projects"]): string {
  const project = projects.find((item) => item.id === event.projectId);
  return [
    event.eventType === "meeting" ? "Встреча" : "Мероприятие",
    event.title,
    new Date(event.startsAt).toLocaleDateString("ru-RU"),
    project?.title,
  ].filter(Boolean).join(" · ");
}

export function PaymentCalendarEventPicker({
  events,
  projects,
  projectId,
  selectedEventId,
  revision = false,
  onSelect,
}: PaymentCalendarEventPickerProps) {
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [eventType, setEventType] = useState("all");
  const [projectFilter, setProjectFilter] = useState("project");
  const now = useCalendarEventClock(events);
  const prefix = revision ? "Исправленные " : "";
  const searchableEvents = events.filter((event) =>
    event.status === "scheduled"
    && (event.eventType === "meeting" || event.eventType === "general")
    && event.canEdit
    && Date.parse(event.endsAt) > now
    && (!event.projectId || projects.some((project) => project.id === event.projectId))
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const filteredEvents = searchableEvents.filter((event) => {
    const text = `${event.title} ${event.description} ${event.location}`.toLocaleLowerCase("ru-RU");
    const date = localDateKey(event.startsAt);
    return (!normalizedQuery || text.includes(normalizedQuery))
      && (!dateFrom || date >= dateFrom)
      && (!dateTo || date <= dateTo)
      && (eventType === "all" || event.eventType === eventType)
      && (!projectId || projectFilter === "all" || event.projectId === projectId);
  }).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const selectedIsFilteredOut = selectedEventId && !filteredEvents.some((event) => event.id === selectedEventId);
  const datesReversed = !!dateFrom && !!dateTo && dateFrom > dateTo;

  return <div className="payment-event-picker payment-field-wide">
    <div className="payment-event-picker-heading">
      <strong>Встреча или мероприятие из календаря <b>обязательно</b></strong>
      <span>Найдём нужное событие по названию, периоду или проекту.</span>
    </div>
    <div className="payment-event-picker-filters">
      <label className="payment-event-picker-search">Поиск по событию
        <Input type="search" aria-label={`${prefix}поиск события`} placeholder="Название, описание или место"
          value={query} onChange={(_event, data) => setQuery(data.value)} />
      </label>
      <label>Дата с
        <Input type="date" aria-label={`${prefix}дата события с`} value={dateFrom}
          onChange={(_event, data) => setDateFrom(data.value)} />
      </label>
      <label>Дата по
        <Input type="date" aria-label={`${prefix}дата события по`} value={dateTo}
          onChange={(_event, data) => setDateTo(data.value)} />
      </label>
      <label>Тип события
        <WorkspaceSelect aria-label={`${prefix}тип события`} value={eventType}
          onChange={(event) => setEventType(event.target.value)}>
          <option value="all">Встречи и мероприятия</option>
          <option value="meeting">Только встречи</option>
          <option value="general">Только мероприятия</option>
        </WorkspaceSelect>
      </label>
      <label>Проект
        <WorkspaceSelect aria-label={`${prefix}фильтр событий по проекту`}
          disabled={!projectId} value={projectId ? projectFilter : "all"}
          onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="all">Все доступные</option>
          <option value="project">Только выбранный проект</option>
        </WorkspaceSelect>
      </label>
    </div>
    {datesReversed ? <p className="payment-event-picker-hint" role="alert">Дата начала периода позже даты окончания.</p> : null}
    <label className="payment-event-picker-choice">Выберите событие
      <WorkspaceSelect aria-label={`${prefix}событие календаря`} required value={selectedEventId}
        onChange={(event) => onSelect(
          event.target.value,
          searchableEvents.find((item) => item.id === event.target.value),
        )}>
        <option value="">Выберите событие</option>
        {selectedIsFilteredOut ? <option value={selectedEventId}>
          {selectedEvent
            ? `${eventLabel(selectedEvent, projects)} · ${Date.parse(selectedEvent.endsAt) <= now ? "завершилось" : "вне текущего фильтра"}`
            : "Ранее выбранное событие"}
        </option> : null}
        {filteredEvents.map((event) => <option key={event.id} value={event.id}>
          {eventLabel(event, projects)}
        </option>)}
      </WorkspaceSelect>
    </label>
    <p className="payment-event-picker-hint" role="status">
      {filteredEvents.length
        ? `Найдено событий: ${filteredEvents.length}`
        : searchableEvents.length
          ? "По фильтрам ничего не найдено. Измените поиск, даты или проект."
          : "Нет доступных событий. Создайте встречу или мероприятие в календаре."}
    </p>
  </div>;
}
