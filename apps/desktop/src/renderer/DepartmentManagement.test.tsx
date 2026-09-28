import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createDepartment, updateDepartment } = vi.hoisted(() => ({ createDepartment: vi.fn(), updateDepartment: vi.fn() }));
vi.mock("./workspace-api", () => ({
  createDepartment,
  updateDepartment,
  updateDepartmentMembers: vi.fn(),
}));

import { DepartmentManagement } from "./DepartmentManagement";

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("DepartmentManagement", () => {
  it("opens the central department even if a regional one is first, and switches without mixing", () => {
    render(<DepartmentManagement token="token" departments={[
      { id: "regional", code: "regional", name: "Регион", scope: "regional", assignedUsersCount: 0 },
      { id: "central", code: "central", name: "ЦА", scope: "central", assignedUsersCount: 0 },
    ]} employees={[]} onChanged={vi.fn()} />);
    const tree = screen.getByLabelText("Список подразделений");
    expect(within(tree).getByText("ЦА", { exact: true }).closest("button")).toHaveAttribute("aria-current", "true");
    expect(within(tree).queryByText("Регион", { exact: true })).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Тип подразделений" })).getByRole("button", { name: "Регионы" }));
    expect(within(tree).getByText("Регион", { exact: true }).closest("button")).toHaveAttribute("aria-current", "true");
    expect(within(tree).queryByText("ЦА", { exact: true })).toBeNull();
  });

  it("lets an administrator correct a regional department and reports a save error", async () => {
    updateDepartment.mockRejectedValueOnce(new Error("Сервер недоступен"));
    render(<DepartmentManagement token="token" departments={[
      { id: "regional", code: "regional", name: "Регион", scope: "regional", assignedUsersCount: 0 },
    ]} employees={[]} onChanged={vi.fn()} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Тип подразделений" })).getByRole("button", { name: "Регионы" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Тип выбранного подразделения" })).getByRole("button", { name: "Центральный аппарат" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить сведения" }));
    await waitFor(() => expect(updateDepartment).toHaveBeenCalledWith("token", "regional", {
      name: "Регион", code: "regional", parentId: null, scope: "central",
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
  });
  it("normalizes a human-readable short code before creating a department", async () => {
    const created = {
      id: "department-2",
      code: "test-otdel",
      name: "Тест отдел",
      scope: "central",
      assignedUsersCount: 0,
      memberIds: [],
      chatId: "department-chat-2",
    };
    createDepartment.mockResolvedValue(created);
    const onChanged = vi.fn();
    render(<DepartmentManagement
      token="token"
      departments={[{ id: "department-1", code: "finance", name: "Финансы", assignedUsersCount: 0, memberIds: [] }]}
      employees={[]}
      onChanged={onChanged}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Новое подразделение" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название нового отдела" }), { target: { value: "Тест отдел" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Код нового отдела" }), { target: { value: "test otdel" } });
    expect(screen.getByRole("textbox", { name: "Код нового отдела" })).toHaveValue("test-otdel");
    fireEvent.click(screen.getByRole("button", { name: /^Создать$/u }));

    await waitFor(() => expect(createDepartment).toHaveBeenCalledWith("token", {
      name: "Тест отдел",
      code: "test-otdel",
      scope: "central",
      parentId: undefined,
    }));
    expect(onChanged).toHaveBeenCalledWith(created);
    expect(await screen.findByText("Подразделение создано. Служебная группа готова.")).toBeInTheDocument();
  });

  it("assigns an active member as the department lead", async () => {
    const department = {
      id: "department-1", code: "media", name: "Пример отдела",
      assignedUsersCount: 1, memberIds: ["user-1"], leadUserId: null,
    };
    updateDepartment.mockResolvedValue({ ...department, leadUserId: "user-1" });
    render(<DepartmentManagement token="token" departments={[department]} employees={[{
      id: "user-1", username: "employee", name: "Пример Сотрудник",
      role: "employee", departmentId: "department-1", status: "active",
    }]} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", {
      name: "Главное лицо отдела или подразделения",
    }), { target: { value: "user-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить главное лицо" }));
    await waitFor(() => expect(updateDepartment).toHaveBeenCalledWith(
      "token", "department-1", { leadUserId: "user-1" },
    ));
    expect(await screen.findByText(/Главное лицо назначено/)).toBeInTheDocument();
  });
});
