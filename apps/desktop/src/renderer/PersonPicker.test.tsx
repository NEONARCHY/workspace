import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonPicker } from "./PersonPicker";
import { workspaceTheme } from "./workspace-theme";
import type { WorkspacePerson } from "@yuksalish/contracts";

const people: WorkspacePerson[] = [
  { id: "aziza", name: "Азиза Каримова", initials: "АК", role: "manager", jobTitle: "Руководитель", color: "#0091a8" },
  { id: "dilshod", name: "Дилшод Рахимов", initials: "ДР", role: "employee", jobTitle: "Специалист", color: "#293a55" },
];
afterEach(cleanup);
describe("Contextual person selection", () => {
  it("searches the provided directory, selects explicitly and closes the context layer", async () => {
    const onChange = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><PersonPicker people={people} value="aziza" label="Ответственный" onChange={onChange} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ответственный" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск: Ответственный" }), { target: { value: "специалист" } });
    const list = screen.getByLabelText("Доступные сотрудники");
    expect(within(list).queryByText("Азиза Каримова")).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: /Дилшод Рахимов/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("dilshod");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Поиск: Ответственный" })).toBeNull());
  });
  it("shows a genuine empty state and cannot select a person outside the directory", () => {
    render(<FluentProvider theme={workspaceTheme}><PersonPicker people={[]} value="" label="Участник" onChange={vi.fn()} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Участник" }));
    expect(screen.getByRole("status")).toHaveTextContent("Сотрудники не найдены");
    expect(within(screen.getByLabelText("Доступные сотрудники")).queryByRole("button")).toBeNull();
  });
  it("keeps the list limited to people and offers clearing outside it", () => {
    const onChange = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><PersonPicker people={people} value="aziza" label="Ответственный" onChange={onChange} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ответственный" }));
    const list = screen.getByLabelText("Доступные сотрудники");
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(within(list).getByRole("button", { name: /Азиза Каримова/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Снять выбор сотрудника" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
  it("never mixes central and regional employees in one picker view", () => {
    const scopedPeople = [
      { ...people[0]!, departmentId: "central" },
      { ...people[1]!, departmentId: "regional" },
    ];
    const departments = [
      { id: "central", code: "central", name: "ЦА", scope: "central" as const, assignedUsersCount: 1 },
      { id: "regional", code: "regional", name: "Регион", scope: "regional" as const, assignedUsersCount: 1 },
    ];
    render(<FluentProvider theme={workspaceTheme}><PersonPicker people={scopedPeople} departments={departments} value="" label="Ответственный" onChange={vi.fn()} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ответственный" }));
    const list = screen.getByLabelText("Доступные сотрудники");
    expect(within(list).getByText("Азиза Каримова")).toBeInTheDocument();
    expect(within(list).queryByText("Дилшод Рахимов")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
    expect(within(list).queryByText("Азиза Каримова")).toBeNull();
    expect(within(list).getByText("Дилшод Рахимов")).toBeInTheDocument();
  });
  it("keeps selection, search and scope controls outside the independently revealing list", () => {
    const onChange = vi.fn();
    const departments = [{ id: "central", code: "central", name: "ЦА", scope: "central" as const, assignedUsersCount: 2 }];
    render(<FluentProvider theme={workspaceTheme}><PersonPicker people={people} departments={departments} value="aziza" label="Ответственный" onChange={onChange} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ответственный" }));
    const search = screen.getByRole("textbox", { name: "Поиск: Ответственный" });
    const list = screen.getByLabelText("Доступные сотрудники");
    expect(list.parentElement).toHaveClass("person-picker-list-viewport");
    expect(list.parentElement).not.toContainElement(search);
    fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
    expect(screen.getByRole("status")).toHaveTextContent("Сотрудники не найдены");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Поиск: Ответственный" })).toBe(search);
    fireEvent.click(screen.getByRole("button", { name: "Центральный аппарат" }));
    expect(within(list).getByRole("button", { name: /Азиза Каримова/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(search, { target: { value: "специалист" } });
    expect(within(list).queryByText("Азиза Каримова")).toBeNull();
    expect(within(list).getByText("Дилшод Рахимов")).toBeInTheDocument();
  });
});
