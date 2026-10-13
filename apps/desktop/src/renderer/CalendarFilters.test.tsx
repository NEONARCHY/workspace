import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { CalendarView } from "./CalendarView";
import { sampleEvent, sampleZoom } from "./test-fixtures/calendar-filter-data";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
const people: WorkspacePerson[] = [
  { id: "me", name: "Анна Левина", initials: "АЛ", role: "employee", color: "brand" },
  { id: "colleague", name: "Вера Ивлева", initials: "ВИ", role: "employee", color: "brand" },
  { id: "organizer", name: "Иван Соколов", initials: "ИС", role: "employee", color: "brand" },
];
function renderCalendar() {
  const create = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><CalendarView currentUserId="me" people={people}
    events={[sampleEvent("Анна: планирование"), sampleEvent("Вера: обсуждение", { attendeeIds: ["colleague"] }),
      sampleEvent("Отменённая встреча", { status: "cancelled" }),
      sampleEvent("Ноябрьская встреча", { startsAt: "2026-11-05T09:00:00", endsAt: "2026-11-05T10:00:00" })]}
    zoomMeetings={[sampleZoom()]} onCreate={create} onUpdate={vi.fn()} onCancel={vi.fn()} /></FluentProvider>);
  fireEvent.change(screen.getByLabelText("Перейти к дате"), { target: { value: "2026-10-13" } });
  return create;
}
it("filters events and Zoom by a searchable employee selection without server writes", () => {
  const create = renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Плитки" }));
  const picker = screen.getByRole("combobox", { name: "Сотрудник в событиях" });
  fireEvent.click(picker);
  fireEvent.change(picker, { target: { value: "Вера" } });
  fireEvent.click(screen.getByRole("option", { name: /Вера Ивлева/ }));
  const list = screen.getByRole("region", { name: "События по датам" });
  expect(within(list).getByText("Вера: обсуждение")).toBeInTheDocument();
  expect(within(list).getByText("Zoom-сессия")).toBeInTheDocument();
  expect(within(list).queryByText("Анна: планирование")).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});
it("opens from the employee arrow without a wrapping label reactivating the input", () => {
  renderCalendar();
  const picker = screen.getByRole("combobox", { name: "Сотрудник в событиях" });
  expect(picker.closest("label")).toBeNull();
  expect(screen.getByLabelText("Сотрудник", { exact: true })).toBe(picker);
  const arrow = screen.getByRole("button", { name: "Open Сотрудник в событиях" });
  fireEvent.mouseDown(arrow);
  fireEvent.mouseUp(arrow);
  fireEvent.click(arrow);
  expect(picker).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("option", { name: /Вера Ивлева/ }));
  expect(picker).toHaveValue("Вера Ивлева");
  expect(picker).toHaveAttribute("aria-expanded", "false");
});
it("shows a chosen date range across months, then clears filters", () => {
  renderCalendar();
  fireEvent.change(screen.getByLabelText("События с даты"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("События по дату"), { target: { value: "2026-11-30" } });
  expect(screen.getByRole("button", { name: "Плитки" })).toHaveAttribute("aria-pressed", "true");
  const list = screen.getByRole("region", { name: "События по датам" });
  expect(within(list).getByText("Ноябрьская встреча")).toBeInTheDocument();
  expect(within(list).queryByText("Анна: планирование")).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("region", { name: "Фильтры календаря" })).getByRole("button", { name: "Сбросить фильтры" }));
  expect(screen.getByLabelText("События с даты")).toHaveValue("");
  expect(screen.getByLabelText("События по дату")).toHaveValue("");
});
it("offers explicit errors/empty-filter states instead of claiming the day is free", () => {
  renderCalendar();
  fireEvent.change(screen.getByLabelText("Поиск событий"), { target: { value: "Нет такого" } });
  expect(screen.getByText("Нет событий по фильтрам")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("События с даты"), { target: { value: "2026-10-14" } });
  fireEvent.change(screen.getByLabelText("События по дату"), { target: { value: "2026-10-13" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Дата окончания");
});
it("provides keyboard navigation and does not intercept an event button's Enter", () => {
  renderCalendar();
  const selected = document.querySelector<HTMLElement>('.calendar-day[aria-selected="true"]')!;
  const before = selected.dataset.calendarDay;
  selected.focus();
  fireEvent.keyDown(selected, { key: "ArrowRight" });
  const after = document.querySelector<HTMLElement>('.calendar-day[aria-selected="true"]')!;
  expect(after.dataset.calendarDay).not.toBe(before);
  expect(after).toHaveFocus();
  const pill = within(screen.getByRole("grid")).getByRole("button", { name: /Анна: планирование/ });
  expect(fireEvent.keyDown(pill, { key: "Enter" })).toBe(true);
});
it("sorts Zoom and events together and can hide cancelled entries", () => {
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Плитки" }));
  const list = screen.getByRole("region", { name: "События по датам" });
  expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Zoom-сессия");
  fireEvent.click(screen.getByRole("checkbox", { name: "Показывать отменённые" }));
  expect(within(list).queryByText("Отменённая встреча")).not.toBeInTheDocument();
});
it("protects the event draft from filter and navigation changes", () => {
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Плитки" }));
  const eventButtons = within(screen.getByRole("region", { name: "События по датам" })).getAllByRole("button");
  const monthView = screen.getByRole("button", { name: "Месяц" });
  const picker = screen.getByRole("combobox", { name: "Сотрудник в событиях" });
  const today = screen.getByRole("button", { name: "Сегодня" });
  fireEvent.click(screen.getByRole("button", { name: "Новое событие" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), { target: { value: "Не терять черновик" } });
  expect(picker).toBeDisabled();
  expect(today).toBeDisabled();
  expect(monthView).toBeDisabled();
  for (const button of eventButtons) expect(button).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Название события" })).toHaveValue("Не терять черновик");
});
it("groups tiles under their dates and keeps each event independently openable", () => {
  renderCalendar();
  fireEvent.change(screen.getByLabelText("События с даты"), { target: { value: "2026-10-13" } });
  fireEvent.change(screen.getByLabelText("События по дату"), { target: { value: "2026-11-05" } });
  const tiles = screen.getByRole("region", { name: "События по датам" });
  const october = within(tiles).getByRole("region", { name: /13 октября 2026/ });
  const november = within(tiles).getByRole("region", { name: /5 ноября 2026/ });
  expect(october.querySelector(".calendar-schedule-tiles")).toBeInTheDocument();
  expect(within(october).getAllByRole("button")).toHaveLength(4);
  expect(within(november).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(within(october).getByRole("button", { name: /Анна: планирование/ }));
  expect(screen.getByRole("dialog", { name: "Анна: планирование" })).toBeInTheDocument();
});
