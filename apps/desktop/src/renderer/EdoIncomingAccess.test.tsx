import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdoIncomingAccess } from "./EdoIncomingAccess";
import { workspaceTheme } from "./workspace-theme";
import { loadEdoAccess, saveEdoAccess } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadEdoAccess: vi.fn(), saveEdoAccess: vi.fn() }));
const config = {
  rules: [
    { userId: "admin", mode: "all" as const, departmentIds: [], revision: 0, editable: false },
    { userId: "manager", mode: "assigned" as const, departmentIds: [], revision: 0, editable: true },
  ],
  departments: [{ id: "finance", name: "Финансы" }, { id: "hr", name: "Кадры" }],
};

function show() {
  render(<FluentProvider theme={workspaceTheme}><EdoIncomingAccess token="synthetic" people={[
    { id: "admin", name: "Администратор", initials: "А", role: "admin", status: "active", color: "teal" },
    { id: "manager", name: "Руководитель", initials: "Р", role: "manager", status: "active", color: "blue" },
  ]} /></FluentProvider>);
}

async function choose(id: string) {
  fireEvent.click(await screen.findByRole("combobox", { name: "Сотрудник для доступа к письмам" }));
  fireEvent.click(await screen.findByRole("option", { name: id === "admin" ? /Администратор/ : /Руководитель/ }));
}

async function chooseMode(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Видимость писем" }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

describe("EDO visibility configuration", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadEdoAccess).mockResolvedValue(config); });
  afterEach(cleanup);

  it("keeps admin full visibility fixed and does not save it", async () => {
    show(); await choose("admin");
    expect(screen.getByRole("combobox", { name: "Видимость писем" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сохранить видимость" })).toBeDisabled();
    expect(saveEdoAccess).not.toHaveBeenCalled();
  });

  it("saves selected departments only on explicit confirmation", async () => {
    vi.mocked(saveEdoAccess).mockResolvedValue({
      userId: "manager", mode: "departments", departmentIds: ["finance"], revision: 1, editable: true,
    });
    show(); await choose("manager");
    await chooseMode("Свои письма и письма подразделений");
    expect(screen.getByRole("button", { name: "Сохранить видимость" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Финансы" }));
    expect(saveEdoAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить видимость" }));
    await waitFor(() => expect(saveEdoAccess).toHaveBeenCalledWith("synthetic", "manager", {
      expectedRevision: 0, mode: "departments", departmentIds: ["finance"],
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Видимость сохранена");
  });

  it("preserves draft on conflict and allows reloading the current rule", async () => {
    vi.mocked(saveEdoAccess).mockRejectedValue(new Error("Видимость уже изменена"));
    show(); await choose("manager");
    await chooseMode("Все входящие письма");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить видимость" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Видимость уже изменена");
    expect(screen.getByRole("combobox", { name: "Видимость писем" })).toHaveTextContent("Все входящие письма");
    fireEvent.click(screen.getByRole("button", { name: "Обновить настройки" }));
    await waitFor(() => expect(loadEdoAccess).toHaveBeenCalledTimes(2));
  });
});
