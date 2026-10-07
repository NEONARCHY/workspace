import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarEvent, PaymentProjectTargets } from "@yuksalish/contracts";

import { PaymentCalendarEventPicker } from "./PaymentCalendarEventPicker";

const projects: PaymentProjectTargets["projects"] = [
  { id: "project-one", title: "Форум", code: "F-26" },
  { id: "project-two", title: "Центр", code: "C-26" },
];

function calendarEvent(
  id: string,
  title: string,
  eventType: CalendarEvent["eventType"],
  startsAt: string,
  projectId?: string,
  description = "",
): CalendarEvent {
  return {
    id, title, description, eventType, startsAt,
    endsAt: startsAt,
    projectId,
    organizerUserId: "user-one",
    allDay: false,
    location: "Зал",
    status: "scheduled",
    attendeeIds: [],
    attendees: [],
    canRespond: false,
    canEdit: true,
    createdAt: startsAt,
    updatedAt: startsAt,
  };
}

const events = [
  calendarEvent("meeting-one", "Планирование форума", "meeting", "2026-10-10T10:00:00", "project-one", "Площадка"),
  calendarEvent("event-one", "Открытие форума", "general", "2026-10-20T10:00:00", "project-one"),
  calendarEvent("meeting-two", "Бюджет центра", "meeting", "2026-11-01T10:00:00", "project-two"),
  calendarEvent("meeting-free", "Общая встреча", "meeting", "2026-10-15T10:00:00"),
];

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-07T12:00:00Z")));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PaymentCalendarEventPicker", () => {
  it("filters by selected project and type, while allowing all accessible events", () => {
    render(<PaymentCalendarEventPicker events={events} projects={projects} projectId="project-one"
      selectedEventId="" onSelect={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Найдено событий: 2");
    fireEvent.change(screen.getByLabelText("тип события"), { target: { value: "general" } });
    expect(screen.getByRole("status")).toHaveTextContent("Найдено событий: 1");
    fireEvent.change(screen.getByLabelText("фильтр событий по проекту"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("тип события"), { target: { value: "meeting" } });
    expect(screen.getByRole("status")).toHaveTextContent("Найдено событий: 3");
  });

  it("searches title, description and date range without clearing the chosen event", () => {
    render(<PaymentCalendarEventPicker events={events} projects={projects} projectId="project-one"
      selectedEventId="meeting-one" onSelect={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("поиск события"), { target: { value: "площадка" } });
    expect(screen.getByRole("status")).toHaveTextContent("Найдено событий: 1");
    fireEvent.change(screen.getByLabelText("дата события с"), { target: { value: "2026-10-11" } });
    fireEvent.change(screen.getByLabelText("дата события по"), { target: { value: "2026-10-30" } });
    expect(screen.getByRole("status")).toHaveTextContent("По фильтрам ничего не найдено");
    expect(screen.getByLabelText("событие календаря")).toHaveValue("meeting-one");
    fireEvent.click(screen.getByLabelText("событие календаря"));
    expect(screen.getByRole("option", { name: /вне текущего фильтра/ })).toBeInTheDocument();
  });

  it("includes both boundary dates of the selected period", () => {
    render(<PaymentCalendarEventPicker events={events} projects={projects} projectId="project-one"
      selectedEventId="" onSelect={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("дата события с"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("дата события по"), { target: { value: "2026-10-20" } });
    expect(screen.getByRole("status")).toHaveTextContent("Найдено событий: 2");
    fireEvent.change(screen.getByLabelText("дата события с"), { target: { value: "2026-10-11" } });
    expect(screen.getByRole("status")).toHaveTextContent("Найдено событий: 1");
    fireEvent.change(screen.getByLabelText("дата события по"), { target: { value: "2026-10-19" } });
    expect(screen.getByRole("status")).toHaveTextContent("По фильтрам ничего не найдено");
  });

  it("hides finished events but keeps ongoing and future events", () => {
    const recentEvents = [
      { ...calendarEvent("expired", "Прошедшая встреча", "meeting", "2026-10-07T10:00:00Z"), endsAt: "2026-10-07T12:00:00Z" },
      { ...calendarEvent("ongoing", "Текущая встреча", "meeting", "2026-10-07T11:00:00Z"), endsAt: "2026-10-07T13:00:00Z" },
      { ...calendarEvent("upcoming", "Будущий форум", "general", "2026-10-08T11:00:00Z"), endsAt: "2026-10-08T13:00:00Z" },
    ];
    render(<PaymentCalendarEventPicker events={recentEvents} projects={projects} projectId=""
      selectedEventId="expired" revision onSelect={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Найдено событий: 2");
    expect(screen.getByLabelText("Исправленные событие календаря")).toHaveValue("expired");
    fireEvent.click(screen.getByLabelText("Исправленные событие календаря"));
    expect(screen.getByRole("option", { name: /Прошедшая встреча.*завершилось/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Текущая встреча/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Будущий форум/ })).toBeInTheDocument();
  });
});
