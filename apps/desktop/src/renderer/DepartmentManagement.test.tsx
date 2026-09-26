import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { createDepartment, updateDepartment } = vi.hoisted(() => ({
  createDepartment: vi.fn(), updateDepartment: vi.fn(),
}));
vi.mock("./workspace-api", () => ({
  createDepartment,
  updateDepartment,
  updateDepartmentMembers: vi.fn(),
}));

import { DepartmentManagement } from "./DepartmentManagement";

describe("DepartmentManagement", () => {
  it("normalizes a human-readable short code before creating a department", async () => {
    const created = {
      id: "department-2",
      code: "test-otdel",
      name: "Тест отдел",
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

    fireEvent.change(screen.getByRole("textbox", { name: "Название нового отдела" }), { target: { value: "Тест отдел" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Код нового отдела" }), { target: { value: "test otdel" } });
    expect(screen.getByRole("textbox", { name: "Код нового отдела" })).toHaveValue("test-otdel");
    fireEvent.click(screen.getByRole("button", { name: "Создать отдел" }));

    await waitFor(() => expect(createDepartment).toHaveBeenCalledWith("token", {
      name: "Тест отдел",
      code: "test-otdel",
      parentId: undefined,
    }));
    expect(onChanged).toHaveBeenCalledWith(created);
    expect(await screen.findByText("Отдел создан. Служебная группа уже готова.")).toBeInTheDocument();
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
