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
});
