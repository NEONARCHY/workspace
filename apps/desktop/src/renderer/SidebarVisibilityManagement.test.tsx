import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryBootstrap, SidebarVisibility, WorkspacePerson } from "@yuksalish/contracts";
import { SidebarVisibilityManagement } from "./SidebarVisibilityManagement";
import { loadSidebarVisibility, saveSidebarVisibility } from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({ loadSidebarVisibility: vi.fn(), saveSidebarVisibility: vi.fn() }));
vi.mock("./ProfileAvatar", () => ({ ProfileAvatar: () => <span aria-hidden="true">АК</span> }));
vi.mock("./PersonPicker", () => ({ PersonPicker: ({ value, people, onChange }: { value: string; people: readonly WorkspacePerson[]; onChange: (id: string) => void }) => <select aria-label="Сотрудник для настройки меню" value={value} onChange={(event) => onChange(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select> }));
const currentUser: WorkspacePerson = { id: "admin", username: "admin", name: "Администратор", initials: "А", color: "brand", role: "admin" };
const directory: DirectoryBootstrap = { roles: [], departments: [], positions: [], modules: [], accessRules: [], employees: [
  { id: "one", username: "aziza", name: "Азиза Каримова", role: "employee", status: "active" },
  { id: "two", username: "baxtiyor", name: "Бахтиёр Самугов", role: "manager", status: "active" },
] };
const base: SidebarVisibility = { userId: "one", hiddenKeys: ["feed"], revision: 3 };
const onClose = vi.fn();
function mount() {
  return render(<FluentProvider theme={workspaceTheme}><SidebarVisibilityManagement token="test" directory={directory} currentUser={currentUser} onClose={onClose} /></FluentProvider>);
}
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadSidebarVisibility).mockResolvedValue(base); });
describe("employee sidebar settings", () => {
  it("loads saved visibility and saves only after confirmation, including payments", async () => {
    vi.mocked(saveSidebarVisibility).mockResolvedValue({ ...base, hiddenKeys: ["feed", "payment_requests"], revision: 4 });
    mount();
    const feed = await screen.findByRole("checkbox", { name: "Лента" });
    expect(feed).not.toBeChecked();
    const payments = screen.getByRole("checkbox", { name: "Заявки на оплату" });
    expect(payments).toBeChecked();
    fireEvent.click(payments);
    expect(saveSidebarVisibility).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить меню" }));
    await waitFor(() => expect(saveSidebarVisibility).toHaveBeenCalledWith("test", "one", ["feed", "payment_requests"], 3));
    expect(await screen.findByRole("status")).toHaveTextContent("Меню сохранено");
    expect(screen.getByRole("button", { name: "Сохранить меню" })).toBeDisabled();
  });
  it("restores buttons with an explicit save and retains changes after failure", async () => {
    vi.mocked(saveSidebarVisibility).mockRejectedValueOnce(new Error("Сервер недоступен"))
      .mockResolvedValueOnce({ ...base, hiddenKeys: [], revision: 4 });
    mount(); await screen.findByRole("checkbox", { name: "Лента" });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть все кнопки" }));
    expect(saveSidebarVisibility).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить меню" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
    expect(screen.getByRole("checkbox", { name: "Лента" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить меню" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Меню сохранено");
    expect(saveSidebarVisibility).toHaveBeenLastCalledWith("test", "one", [], 3);
  });
  it("allows retry after a load error without exposing an editable empty default", async () => {
    vi.mocked(loadSidebarVisibility).mockRejectedValueOnce(new Error("Нет соединения")).mockResolvedValueOnce(base);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет соединения");
    expect(screen.queryByRole("checkbox", { name: "Лента" })).toBeNull();
    expect(screen.getByRole("button", { name: "Сохранить меню" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Обновить настройки" }));
    expect(await screen.findByRole("checkbox", { name: "Лента" })).not.toBeChecked();
  });
  it("blocks duplicate writes and closing while saving", async () => {
    let resolve!: (value: SidebarVisibility) => void;
    vi.mocked(saveSidebarVisibility).mockReturnValue(new Promise((done) => { resolve = done; }));
    mount(); await screen.findByRole("checkbox", { name: "Лента" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить меню" }));
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Меню сотрудника" }));
    expect(saveSidebarVisibility).toHaveBeenCalledTimes(1);
    resolve({ ...base, hiddenKeys: ["feed", "tasks"], revision: 4 });
    await screen.findByRole("status");
  });
  it("discards late responses for the previous employee", async () => {
    let resolve!: (value: SidebarVisibility) => void;
    vi.mocked(loadSidebarVisibility).mockImplementation((_, id) => id === "one"
      ? new Promise((done) => { resolve = done; }) : Promise.resolve({ userId: "two", hiddenKeys: [], revision: 0 }));
    mount();
    fireEvent.change(screen.getByRole("combobox", { name: "Сотрудник для настройки меню" }), { target: { value: "two" } });
    expect(await screen.findByRole("checkbox", { name: "Лента" })).toBeChecked();
    resolve(base);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Лента" })).toBeChecked());
    fireEvent.click(screen.getByRole("checkbox", { name: "Задачи" }));
    vi.mocked(saveSidebarVisibility).mockResolvedValue({ userId: "two", hiddenKeys: ["tasks"], revision: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить меню" }));
    await waitFor(() => expect(saveSidebarVisibility).toHaveBeenCalledWith("test", "two", ["tasks"], 0));
  });
});
