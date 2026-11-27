import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskCalendarView } from "./TaskCalendarView";
import { workspaceTheme } from "./workspace-theme";
import { initialTasks } from "./test-fixtures/demo-data";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("TaskCalendarView", () => {
  it("places month controls in the shared toolbar and returns to today without a duplicate title", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 12));
    const toolbar = document.createElement("div");
    document.body.append(toolbar);
    const view = render(<FluentProvider theme={workspaceTheme}><TaskCalendarView tasks={[]} onSelect={vi.fn()} toolbarTarget={toolbar} /></FluentProvider>);
    expect(screen.queryByText("Рабочий календарь")).not.toBeInTheDocument();
    expect(view.container.querySelector(".calendar-day-summary")).toBeNull();
    expect(view.container.querySelector(".calendar-month-navigation")).toBeNull();
    expect(screen.getByRole("grid")).toHaveAccessibleName(/октябрь 2026/);
    fireEvent.click(within(toolbar).getByRole("button", { name: "Следующий месяц задач" }));
    expect(screen.getByRole("grid")).toHaveAccessibleName(/ноябрь 2026/);
    fireEvent.click(within(toolbar).getByRole("button", { name: "Сегодня" }));
    expect(screen.getByRole("grid")).toHaveAccessibleName(/октябрь 2026/);
    expect(screen.getByRole("gridcell", { name: "3 октября: 0 задач" })).toHaveAttribute("aria-selected", "true");
    view.unmount();
    expect(toolbar).toBeEmptyDOMElement();
    toolbar.remove();
  });

  it("keeps local controls available when rendered without a toolbar target", () => {
    render(<FluentProvider theme={workspaceTheme}><TaskCalendarView tasks={[]} onSelect={vi.fn()} /></FluentProvider>);
    expect(screen.getByRole("button", { name: "Предыдущий месяц задач" }).closest(".task-calendar-local-navigation")).not.toBeNull();
  });
  it("shares the ten-row window between selected-day and unscheduled tasks and resets on day change", () => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const task = initialTasks[0];
    if (!task) throw new Error("Task fixture is missing");
    const tasks = Array.from({ length: 35 }, (_, index) => ({ ...task, id: `task-${index}`, title: `Задача ${index + 1}`, dueAt: index < 25 ? today.toISOString() : undefined }));
    const { container } = render(<FluentProvider theme={workspaceTheme}><TaskCalendarView tasks={tasks} onSelect={vi.fn()} /></FluentProvider>);
    const cards = () => container.querySelectorAll(".calendar-agenda-stream .calendar-agenda-card");
    expect(cards()).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё 10" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё 10" }));
    expect(cards()).toHaveLength(30);
    const emptyDay = screen.getAllByRole("gridcell").find(day => day.getAttribute("aria-label")?.endsWith(": 0 задач"))!;
    fireEvent.click(emptyDay);
    expect(cards()).toHaveLength(10);
    expect(screen.getByRole("region", { name: "Список выбранного дня" })).toHaveTextContent("Без срока");
    fireEvent.click(screen.getByRole("button", { name: "Сегодня" }));
    expect(cards()).toHaveLength(10);
  });
});
