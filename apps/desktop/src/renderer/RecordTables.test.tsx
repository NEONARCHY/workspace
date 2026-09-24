import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectoryEmployee } from "@yuksalish/contracts";
import { TaskRecords } from "./TaskRecords";
import { EmployeeRecords } from "./EmployeeRecords";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";
import { workspaceTheme } from "./workspace-theme";
import { initialTasks, people } from "./test-fixtures/demo-data";

const employees: DirectoryEmployee[] = Array.from({ length: 31 }, (_, i) => ({
  id: `e-${i}`, name: `Сотрудник ${i + 1}`, username: `employee-${i + 1}`, role: "employee", status: i === 30 ? "pending" : "active", jobTitle: "Mutaxassis",
}));
const tasks = Array.from({ length: 31 }, (_, i) => ({ ...initialTasks[0]!, id: `t-${i}`, title: `Задача ${i + 1}`, dueAt: i === 30 ? null : new Date(2026, 8, i + 1).toISOString() }));
const wrap = (node: React.ReactNode, onOpenProfile = vi.fn()) => <FluentProvider theme={workspaceTheme}><EmployeeProfileProvider onOpenProfile={onOpenProfile}>{node}</EmployeeProfileProvider></FluentProvider>;
const employeeRecordProps = (onOpen = vi.fn(), onToggle = vi.fn()) => ({
  departments: [], selectedIds: new Set<string>(), onOpen, onToggle, onTogglePage: vi.fn(),
});
afterEach(cleanup);

describe("Corporate record tables", () => {
  it("shows a semantic task table with real participants and no fictitious activity dates", () => {
    render(wrap(<TaskRecords tasks={tasks} people={people} filterKey="all" onSelect={vi.fn()} />));
    const table = screen.getByRole("table", { name: "Задачи" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    expect(within(table).getByRole("columnheader", { name: /Постановщик/ })).toBeInTheDocument();
    expect(screen.queryByText("Активность")).not.toBeInTheDocument();
  });
  it("paginates and clamps the current page when records disappear", () => {
    const view = render(wrap(<TaskRecords tasks={tasks} people={people} filterKey="all" onSelect={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: "Следующая страница: задачи" }));
    expect(screen.getByRole("status")).toHaveTextContent("26–31 из 31");
    view.rerender(wrap(<TaskRecords tasks={tasks.slice(0, 2)} people={people} filterKey="all" onSelect={vi.fn()} />));
    expect(screen.getByRole("status")).toHaveTextContent("1–2 из 2");
  });
  it("resets pagination for a changed filter and keeps the chosen page size", () => {
    const view = render(wrap(<EmployeeRecords employees={employees} filterKey="all" {...employeeRecordProps()} />));
    fireEvent.click(screen.getByRole("button", { name: "Количество строк на странице: 25. сотрудники" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "10" }));
    fireEvent.click(screen.getByRole("button", { name: "Следующая страница: сотрудники" }));
    expect(screen.getByRole("status")).toHaveTextContent("11–20 из 31");
    view.rerender(wrap(<EmployeeRecords employees={employees} filterKey="active" {...employeeRecordProps()} />));
    expect(screen.getByRole("status")).toHaveTextContent("1–10 из 31");
    view.rerender(wrap(<EmployeeRecords employees={employees} filterKey="all" {...employeeRecordProps()} />));
    expect(screen.getByRole("status")).toHaveTextContent("1–10 из 31");
  });
  it("sorts task names naturally and exposes sort direction", () => {
    render(wrap(<TaskRecords tasks={tasks} people={people} filterKey="all" onSelect={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: /Название/ }));
    expect(screen.getByRole("columnheader", { name: /Название/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[1]).toHaveTextContent("Задача 2");
    fireEvent.click(screen.getByRole("button", { name: /Название/ }));
    expect(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]).toHaveTextContent("Задача 31");
  });
  it("places missing task deadlines last in both directions", () => {
    render(wrap(<TaskRecords tasks={tasks.slice(28)} people={people} filterKey="all" onSelect={vi.fn()} />));
    const sort = screen.getByRole("button", { name: /Крайний срок/ });
    fireEvent.click(sort);
    expect(screen.getAllByRole("button", { name: /^Открыть задачу:/ }).at(-1)).toHaveTextContent("Задача 31");
    fireEvent.click(sort);
    expect(screen.getAllByRole("button", { name: /^Открыть задачу:/ }).at(-1)).toHaveTextContent("Задача 31");
  });
  it("opens an employee from the name and selects it from the rest of the row", () => {
    const onOpen = vi.fn(); const onToggle = vi.fn(); const onOpenProfile = vi.fn();
    render(wrap(<EmployeeRecords employees={employees.slice(0, 1)} filterKey="all" {...employeeRecordProps(onOpen, onToggle)} />, onOpenProfile));
    fireEvent.click(screen.getByRole("button", { name: "Открыть профиль: Сотрудник 1" }));
    expect(onOpenProfile).toHaveBeenCalledWith("e-0"); expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Управление сотрудником: Сотрудник 1" }));
    expect(onOpen).toHaveBeenCalledWith(employees[0]);
    fireEvent.click(screen.getByText("Mutaxassis")); expect(onToggle).toHaveBeenCalledWith("e-0", true);
  });
  it("shows and sorts the assigned department", () => {
    const assigned = employees.slice(0, 2).map((employee, index) => ({ ...employee, departmentId: `d-${index}` }));
    render(wrap(<EmployeeRecords
      employees={assigned}
      filterKey="all"
      {...employeeRecordProps()}
      departments={[
        { id: "d-0", code: "z", name: "Zeta", parentId: null, assignedUsersCount: 1 },
        { id: "d-1", code: "a", name: "Alpha", parentId: null, assignedUsersCount: 1 },
      ]}
    />));
    expect(screen.getByText("Zeta")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Подразделение/ }));
    expect(screen.getAllByRole("button", { name: /^Открыть профиль:/ })[0]).toHaveTextContent("Сотрудник 2");
  });
  it("translates pending activation and handles empty results without a fake page", () => {
    const view = render(wrap(<EmployeeRecords employees={employees.slice(30)} filterKey="pending" {...employeeRecordProps()} />));
    expect(screen.getByText("Ожидает активации")).toBeInTheDocument();
    view.rerender(wrap(<EmployeeRecords employees={[]} filterKey="empty" {...employeeRecordProps()} />));
    expect(screen.getByText("Сотрудники не найдены")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Следующая страница: сотрудники" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Найдено: 0");
  });
});
