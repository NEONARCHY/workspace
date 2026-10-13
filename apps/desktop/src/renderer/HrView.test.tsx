import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { HrOverview, WorkspacePerson } from "@yuksalish/contracts";
import type * as WorkspaceApi from "./workspace-api";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HrView } from "./HrView";
import { workspaceTheme } from "./workspace-theme";
import { createHrProfile, loadHrOverview } from "./workspace-api";

vi.mock("./workspace-api", async (original) => ({ ...await original<typeof WorkspaceApi>(),
  createHrProfile: vi.fn(), loadHrOverview: vi.fn(),
}));
const admin: WorkspacePerson = { id: "qa", name: "Тестовый администратор", initials: "ТА", role: "superadmin", color: "brand" };
const data: HrOverview = { calculatedAt: "2026-10-13", settings: { hrUserId: "hr" }, profiles: [], registers: [] };
beforeEach(() => { vi.mocked(loadHrOverview).mockResolvedValue(data); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("keeps an HR draft after failed save, retries, and restores focus on Escape", async () => {
  vi.mocked(createHrProfile).mockRejectedValue(new Error("Временная ошибка"));
  render(<FluentProvider theme={workspaceTheme}><HrView token="qa-token" currentUser={admin} people={[]} /></FluentProvider>);
  const trigger = await screen.findByRole("button", { name: "Добавить сотрудника" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Новая кадровая карточка" });
  fireEvent.change(within(dialog).getByPlaceholderText("Фамилия Имя Отчество"), { target: { value: "Тестовый сотрудник" } });
  fireEvent.change(within(dialog).getByPlaceholderText("Например: подтверждено трудовой книжкой"), { target: { value: "Тестовое основание" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить карточку" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Временная ошибка");
  expect(within(dialog).getByPlaceholderText("Фамилия Имя Отчество")).toHaveValue("Тестовый сотрудник");
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить карточку" }));
  await waitFor(() => expect(createHrProfile).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Сохранить карточку" })).toBeEnabled());
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it("does not expose HR editing to an unassigned employee", async () => {
  render(<FluentProvider theme={workspaceTheme}><HrView token="qa-token" currentUser={{ ...admin, role: "employee" }} people={[]} /></FluentProvider>);
  await screen.findByRole("tab", { name: "Сотрудники" });
  expect(screen.queryByRole("button", { name: "Добавить сотрудника" })).not.toBeInTheDocument();
  expect(createHrProfile).not.toHaveBeenCalled();
});
