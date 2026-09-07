import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSummary, DirectoryBootstrap, WorkspacePerson } from "@yuksalish/contracts";
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
const createdChat: ChatSummary = { id: "chat-one", title: "Азиза Каримова", kind: "direct", preview: "", time: "", unread: 0, description: "", members: [], permissions: { sendMessages: true, uploadFiles: true, inviteMembers: false, manageMembers: false, editInfo: false } };
const mount = (currentUser = user, props: Partial<React.ComponentProps<typeof EmployeesView>> = {}) => render(<FluentProvider theme={workspaceTheme}><EmployeesView token="test-token" currentUser={currentUser} onInvite={vi.fn()} {...props} /></FluentProvider>);
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
    fireEvent.click(screen.getByRole("button", { name: "К списку сотрудников" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("keeps the selected access draft visible after a server error", async () => {
    vi.mocked(updateEmployeeAccess).mockRejectedValueOnce(new Error("Нет связи"));
    mount(); await screen.findByRole("table");
    const opener = screen.getByRole("button", { name: "Открыть сотрудника: Азиза Каримова" });
    opener.focus(); fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText("Роль доступа"), { target: { value: "manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить сотрудника" }));
    await screen.findByText("Нет связи"); expect(screen.getByLabelText("Роль доступа")).toHaveValue("manager");
    expect(updateEmployeeAccess).toHaveBeenCalledWith("test-token", "one", "manager", "p1");
  });
  it("selects a row and reveals a persistent action bar with an accurate count", async () => {
    mount(); await screen.findByRole("table");
    fireEvent.click(screen.getByLabelText("Выбрать сотрудника: Азиза Каримова"));
    const bar = screen.getByRole("complementary", { name: "Действия с выбранными сотрудниками" });
    expect(bar).toBeInTheDocument();
    expect(within(bar).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Азиза Каримова/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByLabelText("Выбрать всех (2)"));
    expect(within(bar).getByText("2")).toBeInTheDocument();
  });
  it("opens a direct chat for one selected colleague and hands it to messenger", async () => {
    const onCreateChat = vi.fn().mockResolvedValue(createdChat);
    const onChatCreated = vi.fn();
    mount(user, { onCreateChat, onChatCreated }); await screen.findByRole("table");
    fireEvent.click(screen.getByLabelText("Выбрать сотрудника: Азиза Каримова"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть чат" }));
    await waitFor(() => expect(onCreateChat).toHaveBeenCalledWith({ kind: "direct", title: "", description: "", memberIds: ["one"] }));
    expect(onChatCreated).toHaveBeenCalledWith("chat-one");
    expect(screen.queryByRole("complementary", { name: "Действия с выбранными сотрудниками" })).not.toBeInTheDocument();
  });
  it("asks for a group name when several active colleagues are selected", async () => {
    vi.mocked(loadDirectory).mockResolvedValueOnce({ ...data, employees: data.employees.map((employee) => ({ ...employee, status: "active" })) });
    const onCreateChat = vi.fn().mockResolvedValue({ ...createdChat, id: "group-one", title: "Команда", kind: "group" });
    mount(user, { onCreateChat }); await screen.findByRole("table");
    fireEvent.click(screen.getByLabelText("Выбрать сотрудников на странице"));
    fireEvent.click(screen.getByRole("button", { name: "Создать чат" }));
    const title = await screen.findByLabelText("Название новой группы");
    fireEvent.change(title, { target: { value: "Команда проекта" } });
    fireEvent.click(await screen.findByRole(
      "button",
      { name: "Создать и открыть" },
      { timeout: 5_000 },
    ));
    await waitFor(() => expect(onCreateChat).toHaveBeenCalledWith({ kind: "group", title: "Команда проекта", description: "Группа создана из списка сотрудников.", memberIds: ["one", "two"] }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Действие с выбранными сотрудниками" })).not.toBeInTheDocument());
  });
  it("changes the position for every selected editable employee", async () => {
    vi.mocked(updateEmployeeAccess).mockImplementation(async (_, id, role, positionId) => ({ ...data.employees.find((employee) => employee.id === id)!, role, positionId, jobTitle: "Mutaxassis" }));
    mount(); await screen.findByRole("table");
    fireEvent.click(screen.getByLabelText("Выбрать сотрудников на странице"));
    fireEvent.click(screen.getByRole("button", { name: "Изменить должность" }));
    expect(screen.getByRole("button", { name: "Применить" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Новая должность для выбранных сотрудников"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    await screen.findByText("Должность обновлена для 2 сотрудников.");
    expect(updateEmployeeAccess).toHaveBeenCalledTimes(2);
    expect(updateEmployeeAccess).toHaveBeenCalledWith("test-token", "one", "employee", "p1");
    expect(updateEmployeeAccess).toHaveBeenCalledWith("test-token", "two", "manager", "p1");
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
