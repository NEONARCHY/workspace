import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { HrOverview, WorkspacePerson } from "@yuksalish/contracts";
import type * as WorkspaceApi from "./workspace-api";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HrView } from "./HrView";
import { workspaceTheme } from "./workspace-theme";
import { createHrProfile, loadHrOverview, saveHrProfile } from "./workspace-api";
import * as profileLinks from "./EmployeeProfileLink";

vi.mock("./workspace-api", async (original) => ({ ...await original<typeof WorkspaceApi>(),
  createHrProfile: vi.fn(), loadHrOverview: vi.fn(), saveHrProfile: vi.fn(),
  loadDossierContext: vi.fn().mockResolvedValue({ canManageAccess: false, canViewPhotoRoster: false }),
}));
const admin: WorkspacePerson = { id: "qa", name: "Тестовый администратор", initials: "ТА", role: "superadmin", color: "brand" };
const data: HrOverview = { calculatedAt: "2026-10-13", settings: { hrUserId: "hr" }, profiles: [], registers: [] };
beforeEach(() => { vi.mocked(loadHrOverview).mockResolvedValue(data); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it("cancels an obsolete HR request and never lets its late result replace the new account data", async () => {
  let finish!: (value: HrOverview) => void;
  vi.mocked(loadHrOverview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<FluentProvider theme={workspaceTheme}><HrView token="old-token" currentUser={admin} people={[]} /></FluentProvider>);
  await waitFor(() => expect(loadHrOverview).toHaveBeenCalled());
  const oldSignal = vi.mocked(loadHrOverview).mock.calls.at(-1)![1]!;
  expect(oldSignal.aborted).toBe(false);
  view.rerender(<FluentProvider theme={workspaceTheme}><HrView token="new-token" currentUser={admin} people={[]} /></FluentProvider>);
  await waitFor(() => expect(screen.getByRole("region", { name: "Кадровые карточки" })).toHaveAttribute("aria-busy", "false"));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finish({ ...data, settings: {} }));
  expect(screen.queryByText("Назначьте участников маршрута")).not.toBeInTheDocument();
  const latestSignal = vi.mocked(loadHrOverview).mock.calls.at(-1)![1]!;
  view.unmount(); expect(latestSignal.aborted).toBe(true);
});

it("pages every HR record and leaves the list untouched while an editor draft changes", async () => {
  vi.mocked(loadHrOverview).mockResolvedValue({ ...data, profiles: Array.from({ length: 32 }, (_, i) => ({
    id: `profile-${i}`, fullName: `Тестовый Сотрудник ${i + 1}`, employmentDate: "2020-01-01", serviceAnchorDate: data.calculatedAt,
    serviceYears: 6, serviceMonths: 9, serviceDays: 12, allowancePercent: 10, employmentStatus: "active", hiddenAfterYear: false, updatedAt: "2026-10-13T00:00:00Z",
  })) });
  const profiles = vi.spyOn(profileLinks, "EmployeeProfileLink");
  render(<FluentProvider theme={workspaceTheme}><HrView token="qa-token" currentUser={admin} people={[]} /></FluentProvider>);
  await waitFor(() => expect(document.querySelectorAll(".hr-row")).toHaveLength(25));
  fireEvent.click(screen.getByRole("button", { name: "Следующая страница: кадровые карточки" }));
  expect(document.querySelectorAll(".hr-row")).toHaveLength(7);
  fireEvent.change(screen.getByRole("textbox", { name: "Поиск кадровой карточки" }), { target: { value: "нет-совпадений" } });
  expect(document.querySelectorAll(".hr-row")).toHaveLength(0);
  fireEvent.change(screen.getByRole("textbox", { name: "Поиск кадровой карточки" }), { target: { value: "" } });
  expect(document.querySelectorAll(".hr-row")).toHaveLength(25);
  fireEvent.click(screen.getByRole("button", { name: "Кадровая карточка" }));
  profiles.mockClear();
  fireEvent.change(screen.getByPlaceholderText("Фамилия Имя Отчество"), { target: { value: "Сохранить черновик" } });
  expect(profiles).not.toHaveBeenCalled();
});

it("keeps an HR draft after failed save, retries, and restores focus on Escape", async () => {
  vi.mocked(createHrProfile).mockRejectedValue(new Error("Временная ошибка"));
  render(<FluentProvider theme={workspaceTheme}><HrView token="qa-token" currentUser={admin} people={[]} /></FluentProvider>);
  const trigger = await screen.findByRole("button", { name: "Кадровая карточка" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Кадровая карточка" });
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
  expect(screen.queryByRole("button", { name: "Кадровая карточка" })).not.toBeInTheDocument();
  expect(createHrProfile).not.toHaveBeenCalled();
});

it("saves organization employment date against the selected employee and keeps input on failure", async () => {
  const person: WorkspacePerson = { ...admin, id: "employee", name: "Тестовый Специалист", role: "employee" };
  vi.mocked(saveHrProfile).mockRejectedValueOnce(new Error("Ошибка сохранения"));
  render(<FluentProvider theme={workspaceTheme}><HrView token="qa-token" currentUser={admin} people={[person]} /></FluentProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Кадровая карточка" }));
  fireEvent.click(screen.getByRole("button", { name: "Сотрудник кадровой карточки" }));
  fireEvent.click(screen.getByRole("button", { name: /Тестовый Специалист/ }));
  const dialog = screen.getByRole("dialog", { name: "Кадровая карточка" });
  const employment = within(dialog).getByLabelText("Дата приёма");
  expect(employment).toHaveValue("");
  expect(within(dialog).getByRole("button", { name: "Сохранить карточку" })).toBeDisabled();
  fireEvent.change(employment, { target: { value: "2019-03-01" } });
  fireEvent.change(within(dialog).getByPlaceholderText("Например: подтверждено трудовой книжкой"), { target: { value: "По приказу о приёме" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить карточку" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ошибка сохранения");
  expect(employment).toHaveValue("2019-03-01");
  expect(saveHrProfile).toHaveBeenCalledWith("qa-token", "employee", expect.objectContaining({ employmentDate: "2019-03-01" }));
  expect(createHrProfile).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить карточку" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("opens existing linked tenure at its calculation date without double-counting elapsed service", async () => {
  const person: WorkspacePerson = { ...admin, id: "employee", name: "Тестовый Специалист", role: "employee" };
  vi.mocked(loadHrOverview).mockResolvedValue({ ...data, profiles: [{
    id: "profile", userId: person.id, fullName: person.name, employmentDate: "2019-03-01",
    serviceAnchorDate: "2020-01-01", serviceYears: 7, serviceMonths: 7, serviceDays: 12,
    allowancePercent: 10, employmentStatus: "active", hiddenAfterYear: false, updatedAt: "2026-10-13T00:00:00Z",
  }] });
  render(<FluentProvider theme={workspaceTheme}><HrView token="qa-token" currentUser={admin} people={[person]} /></FluentProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Кадровая карточка" }));
  fireEvent.click(screen.getByRole("button", { name: "Сотрудник кадровой карточки" }));
  fireEvent.click(screen.getByRole("button", { name: /Тестовый Специалист/ }));
  const dialog = screen.getByRole("dialog", { name: "Кадровая карточка" });
  expect(within(dialog).getByLabelText("Дата приёма")).toHaveValue("2019-03-01");
  expect(within(dialog).getByLabelText("Дата подтверждения стажа")).toHaveValue(data.calculatedAt);
  expect(within(dialog).getByLabelText("Лет")).toHaveValue(7);
  fireEvent.change(within(dialog).getByPlaceholderText("Например: подтверждено трудовой книжкой"), { target: { value: "Уточнение даты по приказу" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить карточку" }));
  await waitFor(() => expect(saveHrProfile).toHaveBeenCalledWith("qa-token", person.id, expect.objectContaining({
    serviceAnchorDate: data.calculatedAt, serviceYears: 7, serviceMonths: 7, serviceDays: 12,
  })));
});
it("keeps the header through loading and retry without presenting missing data as an unconfigured route", async () => {
  vi.mocked(loadHrOverview).mockRejectedValueOnce(new Error("Сервер временно недоступен"));
  render(<FluentProvider theme={workspaceTheme}><HrView token="qa-token" currentUser={admin} people={[]} /></FluentProvider>);
  const heading = screen.getByRole("heading", { name: "HR · Кадровое пространство" });
  expect(screen.getByLabelText("Загружаем HR…")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("tab", { name: "Сотрудники" })).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  expect(await screen.findByRole("alert")).toHaveTextContent("Сервер временно недоступен");
  expect(screen.queryByLabelText("Загружаем HR…")).toBeNull();
  expect(screen.queryByText("Назначьте участников маршрута")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await screen.findByRole("tab", { name: "Сотрудники" });
  expect(screen.getByRole("heading", { name: "HR · Кадровое пространство" })).toHaveTextContent(heading.textContent!);
});
