import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(cleanup);

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
});
