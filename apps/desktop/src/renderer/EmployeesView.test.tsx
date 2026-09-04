import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryBootstrap, WorkspacePerson } from "@yuksalish/contracts";
import { EmployeesView } from "./EmployeesView";
import { workspaceTheme } from "./workspace-theme";
import { loadDirectory, updateEmployeeAccess, updatePosition } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadDirectory: vi.fn(), updateEmployeeAccess: vi.fn(), updatePosition: vi.fn(), createPosition: vi.fn() }));
const user: WorkspacePerson = { id: "me", username: "admin", name: "Администратор", initials: "А", role: "admin", color: "brand" };
const data: DirectoryBootstrap = {
  roles: [{ key: "employee", label: "Сотрудник", description: "" }, { key: "manager", label: "Руководитель", description: "" }],
  positions: [{ id: "p1", name: "Mutaxassis", isActive: true, sortOrder: 0, source: "manual", assignedUsersCount: 1 }],
  employees: [
    { id: "one", name: "Азиза Каримова", username: "aziza", role: "employee", jobTitle: "Mutaxassis", positionId: "p1", status: "active" },
    { id: "two", name: "Бахтиёр Самугов", username: "baxtiyor", role: "manager", status: "pending" },
  ],
};
const mount = (currentUser = user) => render(<FluentProvider theme={workspaceTheme}><EmployeesView token="test-token" currentUser={currentUser} onInvite={vi.fn()} /></FluentProvider>);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadDirectory).mockResolvedValue(data); });
afterEach(cleanup);

describe("Employee list and retained access controls", () => {
  it("filters by role and pending activation without changing server data", async () => {
    mount(); await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Фильтр по роли сотрудника"), { target: { value: "manager" } });
    fireEvent.change(screen.getByLabelText("Фильтр состояния сотрудников"), { target: { value: "invited" } });
    expect(screen.getAllByRole("button", { name: /^Открыть сотрудника:/ })).toHaveLength(1);
    expect(screen.getByText("Бахтиёр Самугов")).toBeInTheDocument();
    expect(updateEmployeeAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(screen.getAllByRole("button", { name: /^Открыть сотрудника:/ })).toHaveLength(2);
  });
  it("does not expose invitations or editable permissions to a regular employee", async () => {
    mount({ ...user, role: "employee" }); await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Пригласить сотрудника" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть сотрудника: Азиза Каримова" }));
    expect(screen.getByLabelText("Роль доступа")).toBeDisabled();
    expect(screen.getByLabelText("Должность")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Сохранить сотрудника" })).not.toBeInTheDocument();
  });
  it("saves the selected employee and keeps the editor after a server error", async () => {
    vi.mocked(updateEmployeeAccess).mockRejectedValueOnce(new Error("Нет связи")).mockResolvedValueOnce({ ...data.employees[0]!, role: "manager" });
    mount(); await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Открыть сотрудника: Азиза Каримова" }));
    fireEvent.change(screen.getByLabelText("Роль доступа"), { target: { value: "manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить сотрудника" }));
    await screen.findByText("Нет связи"); expect(screen.getByLabelText("Роль доступа")).toHaveValue("manager");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить сотрудника" }));
    await screen.findByText(/Роль и должность сотрудника сохранены/);
    expect(updateEmployeeAccess).toHaveBeenLastCalledWith("test-token", "one", "manager", "p1");
  });
  it("renames a position and updates its visible name on employee rows", async () => {
    vi.mocked(updatePosition).mockResolvedValue({ ...data.positions[0]!, name: "Yetakchi mutaxassis" });
    mount(); await screen.findByRole("table"); fireEvent.click(screen.getByRole("button", { name: "Должности" }));
    screen.getByRole("button", { name: "К списку сотрудников" }).focus();
    fireEvent.change(screen.getByLabelText("Название должности"), { target: { value: "Yetakchi mutaxassis" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить должность" }));
    await screen.findByText(/Должность обновлена/);
    fireEvent.click(screen.getByRole("button", { name: "К списку сотрудников" }));
    await waitFor(() => expect(document.querySelector(".employee-position")).toHaveTextContent("Yetakchi mutaxassis"));
  });
  it("retries a failed directory load without a permanently spinning screen", async () => {
    vi.mocked(loadDirectory).mockRejectedValueOnce(new Error("Сервер недоступен")).mockResolvedValueOnce(data);
    mount(); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    expect(await screen.findByRole("table")).toBeInTheDocument(); expect(loadDirectory).toHaveBeenCalledTimes(2);
  });
});
