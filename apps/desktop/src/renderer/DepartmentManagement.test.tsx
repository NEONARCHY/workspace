import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { createDepartment } = vi.hoisted(() => ({ createDepartment: vi.fn() }));
vi.mock("./workspace-api", () => ({
  createDepartment,
  updateDepartment: vi.fn(),
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
});
