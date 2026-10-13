import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";
import { sampleEvent } from "./test-fixtures/calendar-filter-data";
import { workspaceTheme } from "./workspace-theme";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(initialWidth = 390, initialHeight = 844) {
  let width = initialWidth;
  let height = initialHeight;
  let resize = () => {};
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("calendar-view") ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("calendar-view") ? height : 0;
  });
  vi.stubGlobal("ResizeObserver", class implements ResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      if (target.classList.contains("calendar-view")) resize = () => this.callback([{
        target, contentRect: target.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
      }], this);
    }
    unobserve() {}
    disconnect() {}
  });
  const events = Array.from({ length: 5 }, (_, index) => sampleEvent(`Встреча ${index + 1}`, { description: "План команды" }));
  const create = vi.fn();
  const result = render(<FluentProvider theme={workspaceTheme} className="app-provider"><CalendarView events={events} people={[]}
    currentUserId="me" onCreate={create} onUpdate={vi.fn()} onCancel={vi.fn()} /></FluentProvider>);
  fireEvent.change(screen.getByLabelText("Перейти к дате"), { target: { value: "2026-10-13" } });
  const day = () => screen.getByRole("gridcell", { name: /13 октября 2026.*событий: 5/ });
  return { ...result, create, day, resize: (nextWidth: number, nextHeight = height) => act(() => { width = nextWidth; height = nextHeight; resize(); }) };
}
it("uses the right overlay in a short landscape phone without losing the day after rotation", async () => {
  const { day, resize } = setup(844, 320);
  expect(screen.queryByRole("complementary", { name: "События выбранного дня" })).not.toBeInTheDocument();
  fireEvent.click(day());
  expect(screen.getByRole("dialog", { name: "Расписание выбранного дня" })).toBeInTheDocument();
  resize(1024, 768);
  expect(screen.getByRole("complementary", { name: "События выбранного дня" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Расписание выбранного дня" })).not.toBeInTheDocument());
  expect(day()).toHaveAttribute("aria-selected", "true");
});
it.each(["Escape", "close button"])("opens a complete phone day and returns focus after %s", async dismissal => {
  const { day } = setup();
  expect(screen.queryByRole("complementary", { name: "События выбранного дня" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Расписание выбранного дня" })).not.toBeInTheDocument();
  day().focus(); fireEvent.click(day());
  const agenda = screen.getByRole("dialog", { name: "Расписание выбранного дня" });
  expect(within(agenda).getAllByRole("button", { name: /Встреча [1-5]/ })).toHaveLength(5);
  expect(within(agenda).getByText("записей в расписании")).toBeInTheDocument();
  if (dismissal === "Escape") fireEvent.keyDown(agenda, { key: "Escape" });
  else fireEvent.click(within(agenda).getByRole("button", { name: "Закрыть расписание" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Расписание выбранного дня" })).not.toBeInTheDocument());
  await waitFor(() => expect(day()).toHaveFocus());
  expect(day()).toHaveAttribute("aria-selected", "true");
});
it("opens event details above the agenda without remounting its entry or changing the day", async () => {
  const { day } = setup();
  const selectedDay = day();
  selectedDay.focus(); fireEvent.click(selectedDay);
  const agenda = screen.getByRole("dialog", { name: "Расписание выбранного дня" });
  await waitFor(() => expect(agenda.contains(document.activeElement)).toBe(true));
  const entry = within(agenda).getByRole("button", { name: /Встреча 4/ });
  fireEvent.click(entry);
  const details = screen.getByRole("dialog", { name: "Встреча 4" });
  expect(agenda.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(details).getByText("План команды")).toBeInTheDocument();
  const close = within(details).getByRole("button", { name: "Закрыть событие" });
  close.focus(); fireEvent.click(close);
  // A closing surface is aria-hidden before its exit finishes. Wait for actual
  // removal, otherwise the parent modal is still intentionally inaccessible.
  await waitFor(() => expect(details).not.toBeInTheDocument());
  // Exact nested-modal focus restoration needs browser layout and is covered
  // by browser QA. Here verify that the original target remains available.
  expect(await within(agenda).findByRole("button", { name: /Встреча 4/ })).toBe(entry);
  expect(selectedDay).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("dialog", { name: "Расписание выбранного дня" })).toBeInTheDocument();
});
it("keeps the tablet agenda inline and preserves the selected day through resize", async () => {
  const { day, resize, container } = setup(768);
  expect(container.querySelector(".calendar-agenda-inline")).not.toBeNull();
  expect(screen.getByRole("complementary", { name: "События выбранного дня" })).toBeInTheDocument();
  resize(390); fireEvent.click(day());
  expect(screen.getByRole("dialog", { name: "Расписание выбранного дня" })).toBeInTheDocument();
  resize(1024);
  expect(screen.getByRole("complementary", { name: "События выбранного дня" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Расписание выбранного дня" })).not.toBeInTheDocument());
  expect(day()).toHaveAttribute("aria-selected", "true");
});
it("does not interrupt arrow-key day navigation but opens the agenda with Enter", () => {
  const { day } = setup();
  fireEvent.keyDown(day(), { key: "ArrowRight" });
  expect(screen.queryByRole("dialog", { name: "Расписание выбранного дня" })).not.toBeInTheDocument();
  const next = screen.getByRole("gridcell", { name: /14 октября 2026/ });
  expect(next).toHaveFocus();
  fireEvent.keyDown(next, { key: "Enter" });
  expect(screen.getByRole("dialog", { name: "Расписание выбранного дня" })).toBeInTheDocument();
});
it("collapses mobile filters without clearing the chosen search", () => {
  setup();
  const toggle = screen.getByRole("button", { name: "Фильтры" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("textbox", { name: "Поиск событий" })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  fireEvent.change(screen.getByRole("textbox", { name: "Поиск событий" }), { target: { value: "Встреча 4" } });
  fireEvent.click(screen.getByRole("button", { name: "Фильтры · 1" }));
  expect(screen.queryByRole("textbox", { name: "Поиск событий" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /События выбранного дня · 1/ }));
  const agenda = screen.getByRole("dialog", { name: "Расписание выбранного дня" });
  expect(within(agenda).getByRole("button", { name: /Встреча 4/ })).toBeInTheDocument();
  expect(within(agenda).queryByText("Встреча 1")).not.toBeInTheDocument();
});
it("creates a draft from the drawer only after an explicit Add action", () => {
  const { create } = setup();
  fireEvent.change(screen.getByLabelText("Перейти к дате"), { target: { value: "2099-10-13" } });
  fireEvent.click(screen.getByRole("gridcell", { name: /13 октября 2099/ }));
  const agenda = screen.getByRole("dialog", { name: "Расписание выбранного дня" });
  fireEvent.click(within(agenda).getByRole("button", { name: "Добавить" }));
  expect(screen.getByRole("textbox", { name: "Название события" })).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});
