import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";
import { calendarAppearanceStyle } from "./CalendarAppearance";
import { workspaceTheme } from "./workspace-theme";
import type { CalendarEvent, WorkspacePerson } from "@yuksalish/contracts";

afterEach(cleanup);
const chair: WorkspacePerson = { id: "chair", name: "Бобур Бекмуродов", initials: "ББ", role: "employee", color: "brand", jobTitle: '"Yuksalish" harakati raisi, Qonunchilik palatasi qo\'mita raisi' };
function calendar(status: "accepted" | "pending" = "accepted") {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const event: CalendarEvent = { id: "reserved", organizerUserId: "other", title: "Подтверждённая встреча", description: "", eventType: "meeting", startsAt: day.toISOString(), endsAt: new Date(day.getTime() + 86400000).toISOString(), allDay: false, location: "", status: "scheduled", attendeeIds: [chair.id], attendees: [{ userId: chair.id, status }], canRespond: false, canEdit: false, createdAt: day.toISOString(), updatedAt: day.toISOString() };
  const create = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><CalendarView events={[event]} people={[chair]} currentUserId="me" onCreate={create} onUpdate={vi.fn()} onCancel={vi.fn()} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Новое событие" }));
  return create;
}
it("warns on inviting the already-confirmed chairman without changing the draft", () => {
  const create = calendar();
  const checkbox = screen.getByRole("checkbox", { name: /Бобур Бекмуродов/ });
  expect(checkbox).toBeEnabled();
  fireEvent.click(checkbox);
  expect(screen.getByRole("dialog", { name: "Участник уже занят" })).toHaveTextContent("Бобур Бекмуродов уже занят");
  expect(checkbox).not.toBeChecked();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Понятно" }));
  expect(screen.getByRole("textbox", { name: "Название события" })).toBeInTheDocument();
});
it("does not reserve the chairman's time for a pending invitation", () => {
  calendar("pending");
  fireEvent.click(screen.getByRole("checkbox", { name: /Бобур Бекмуродов/ }));
  expect(screen.getByRole("checkbox", { name: /Бобур Бекмуродов/ })).toBeChecked();
  expect(screen.queryByRole("dialog", { name: "Участник уже занят" })).not.toBeInTheDocument();
});
it("offers every requested icon, presets and a custom RGB color", () => {
  calendar("pending");
  for (const name of ["Три дерева", "Сдача крови", "Слушание", "Собрание", "Встреча", "Поездка", "Проект", "Тимбилдинг", "Горы", "Договор", "Меморандум", "Тренинг", "Интервью"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Тренинг" }));
  expect(screen.getByRole("button", { name: "Тренинг" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(screen.getByLabelText("Свой цвет события"), { target: { value: "#669988" } });
  expect(screen.getByLabelText("Предпросмотр оформления события")).toHaveStyle({ "--ws-surface-accent": "#669988" });
  expect(screen.queryByRole("button", { name: "Zoom" })).not.toBeInTheDocument();
  expect(calendarAppearanceStyle({ color: "url(https://invalid)" })).toBeUndefined();
});
