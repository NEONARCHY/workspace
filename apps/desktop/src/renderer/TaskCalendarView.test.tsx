import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskCalendarView } from "./TaskCalendarView";
import { workspaceTheme } from "./workspace-theme";

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
});
