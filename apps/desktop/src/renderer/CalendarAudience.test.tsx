import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { CalendarView } from "./CalendarView";
import { workspaceTheme } from "./workspace-theme";
import { people } from "./test-fixtures/demo-data";

const departments: WorkspaceDepartment[] = [
  { id: "ca", name: "ЦА", code: "ca", scope: "central", assignedUsersCount: 2 },
  { id: "region", name: "Регион", code: "region", scope: "regional", assignedUsersCount: 2 },
  { id: "regional-child", name: "Подразделение", code: "child", scope: "central", parentId: "region", assignedUsersCount: 1 },
];
const staff: WorkspacePerson[] = [
  { ...people[0]!, id: "leader", name: "Организатор", departmentId: "ca", status: "active" },
  { ...people[1]!, id: "central", name: "Сотрудник ЦА", departmentId: "ca", status: "active" },
  { ...people[1]!, id: "region-person", name: "Сотрудник региона", departmentId: "region", status: "active" },
  { ...people[1]!, id: "child-person", name: "Сотрудник подразделения", departmentId: "regional-child", status: "active" },
  { ...people[1]!, id: "blocked", name: "Заблокированный", departmentId: "region", status: "blocked" },
];
function openCalendar(canInviteCalendarAudience = true, employees = staff, create = vi.fn()) {
  render(<FluentProvider theme={workspaceTheme}><CalendarView events={[]} people={employees} departments={departments}
    currentUserId="leader" canInviteCalendarAudience={canInviteCalendarAudience}
    onCreate={create} onUpdate={vi.fn()} onCancel={vi.fn()} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Новое событие" }));
  return create;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Calendar audience commands", () => {
  it("keeps ordinary users on individual selection", () => {
    openCalendar(false);
    expect(screen.queryByRole("group", { name: "Пригласить всех сотрудников" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Сотрудник ЦА" })).toBeInTheDocument();
  });
  it("selects central, regional descendants, or both without inactive staff or duplicate organizer", () => {
    openCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Все ЦА" }));
    expect(screen.getByText("Выбрано участников: 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все регионы" }));
    expect(screen.getByText("Выбрано участников: 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Регионы" }));
    expect(screen.getByRole("checkbox", { name: "Сотрудник подразделения" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Заблокированный" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ЦА и регионы" }));
    expect(screen.getByText("Выбрано участников: 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ЦА и регионы" })).toHaveAttribute("aria-pressed", "true");
  });
  it("sends a scope command instead of a truncated list even above 100 participants and keeps it after failure", async () => {
    const employees = [staff[0]!, ...Array.from({ length: 130 }, (_, i) => ({ ...staff[1]!, id: `staff-${i}` }))];
    const create = openCalendar(true, employees, vi.fn().mockRejectedValue(new Error("Заняты сотрудники. Выберите другое время.")));
    fireEvent.click(screen.getByRole("button", { name: "Все ЦА" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), { target: { value: "Общее совещание" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать мероприятие" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ audienceScope: "central", attendeeIds: [] })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Заняты сотрудники");
    expect(screen.getByText("Выбрано участников: 131")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Название события" })).toHaveValue("Общее совещание");
  });
  it("returns to explicit IDs when a selected person is unchecked", async () => {
    const create = openCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Все ЦА" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Сотрудник ЦА" }));
    expect(screen.getByRole("button", { name: "Все ЦА" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), { target: { value: "Моя встреча" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать мероприятие" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ audienceScope: undefined, attendeeIds: ["leader"] })));
  });
});
