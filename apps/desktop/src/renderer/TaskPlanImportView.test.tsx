import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";

import { TaskPlanImportView } from "./TaskPlanImportView";
import { confirmTaskPlanImport, previewTaskPlanImport } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  previewTaskPlanImport: vi.fn(), confirmTaskPlanImport: vi.fn(),
  ApiHttpError: class ApiHttpError extends Error {},
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("keeps extracted rows local until confirmation and supports excluding an item", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Work plan", rows: [
      { title: "Prepare regional forum", source: "Sheet!2", warning: null },
      { title: "Header repeated", source: "Sheet!3", warning: "Проверьте дубль" },
    ],
  });
  vi.mocked(confirmTaskPlanImport).mockResolvedValue({
    id: "plan-1", title: "Work plan", kind: "work", periodStart: null, periodEnd: null,
    taskIds: ["task-1"], ownerUserId: "me", status: "active", createdByUserId: "me", createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const onImported = vi.fn().mockResolvedValue(undefined);
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[{
      id: "me", name: "Me", initials: "M", role: "manager", color: "blue", status: "active",
    }]} tasks={[]} onImported={onImported} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["1. Prepare regional forum"], "plan.txt")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  expect(await screen.findByDisplayValue("Prepare regional forum")).toBeInTheDocument();
  expect(confirmTaskPlanImport).not.toHaveBeenCalled();
  const actions = screen.getAllByLabelText("Действие");
  const secondAction = actions[1];
  if (!secondAction) throw new Error("Second candidate action is missing");
  fireEvent.click(secondAction);
  fireEvent.click(await screen.findByRole("option", { name: "Не включать" }));
  await waitFor(() => expect(secondAction).toHaveAttribute("value", "skip"));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  await waitFor(() => expect(confirmTaskPlanImport).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(confirmTaskPlanImport).mock.calls[0]?.[1];
  if (!payload) throw new Error("Import confirmation was not sent");
  expect(payload.items).toHaveLength(1);
  expect(payload.plan.ownerUserId).toBe("me");
  expect(payload.items[0]?.assigneeId).toBe("me");
  expect(onImported).toHaveBeenCalledTimes(1);
});

it("keeps the same operation id and edits after a failed confirmation", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Work plan", rows: [{ title: "Prepare forum", source: "TXT, строка 1", warning: null }],
  });
  vi.mocked(confirmTaskPlanImport).mockRejectedValue(new Error("offline"));
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[{
      id: "me", name: "Me", initials: "M", role: "manager", color: "blue", status: "active",
    }]} tasks={[]} onImported={vi.fn()} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["Prepare forum"], "plan.txt")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  await screen.findByDisplayValue("Prepare forum");
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  const originalId = vi.mocked(confirmTaskPlanImport).mock.calls[0]?.[1].operationId;
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  await waitFor(() => expect(confirmTaskPlanImport).toHaveBeenCalledTimes(2));
  expect(vi.mocked(confirmTaskPlanImport).mock.calls[1]?.[1].operationId).toBe(originalId);
});

it("allows different responsible people and co-assignees for tasks in the same week", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Weekly plan", rows: [
      { title: "Manager activity", source: "DOCX, таблица 1, строка 2, столбец 3", warning: null,
        assigneeHint: "Н. Каримбердиева", coexecutorsHint: "Б. Самугов; Матбуот хизмати",
        groupKey: "DOCX, таблица 1, строка 2", dueDateHint: "2026-10-02" },
      { title: "Specialist activity", source: "DOCX, таблица 1, строка 2, столбец 4", warning: null,
        assigneeHint: "Ф. Шокирова", coexecutorsHint: "Б. Самугов; Матбуот хизмати",
        groupKey: "DOCX, таблица 1, строка 2", dueDateHint: "2026-10-03" },
    ],
  });
  vi.mocked(confirmTaskPlanImport).mockResolvedValue({
    id: "plan-2", title: "Weekly plan", kind: "work", periodStart: null, periodEnd: null,
    taskIds: ["task-1", "task-2"], ownerUserId: "me", status: "active", createdByUserId: "me", createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[
      { id: "me", name: "Автор плана", initials: "А", role: "manager", color: "blue", status: "active" },
      { id: "nigora", name: "Каримбердиева Нигора", initials: "Н", role: "manager", color: "blue", status: "active" },
      { id: "bakhtiyor", name: "Самугов Бахтиёр", initials: "Б", role: "employee", color: "blue", status: "active" },
      { id: "feruza", name: "Шокирова Феруза", initials: "Ф", role: "employee", color: "blue", status: "active" },
      { id: "temur", name: "Алмазов Темур", initials: "Т", role: "employee", color: "blue", status: "active" },
    ]} tasks={[]} onImported={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["content"], "weekly.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  expect(await screen.findByText("В документе: Б. Самугов; Матбуот хизмати")).toBeInTheDocument();
  expect(screen.getAllByLabelText("Срок, если указан в плане").map((input) =>
    (input as HTMLInputElement).value)).toEqual(["2026-10-02", "2026-10-03"]);
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Проверьте ответственного");
  expect(confirmTaskPlanImport).not.toHaveBeenCalled();
  const bulkParticipants = screen.getByLabelText("Набор соисполнителей для массового назначения по строке");
  fireEvent.change(bulkParticipants, {
    target: { value: "temur", selectedOptions: [{ value: "bakhtiyor" }, { value: "temur" }] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Применить к пунктам этой строки" }));
  fireEvent.click(screen.getByRole("button", { name: "Изменить соисполнителей пункта 2" }));
  fireEvent.change(screen.getByLabelText("Соисполнители пункта 2"), {
    target: { value: "bakhtiyor", selectedOptions: [{ value: "bakhtiyor" }] },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  await waitFor(() => expect(confirmTaskPlanImport).toHaveBeenCalledTimes(1));
  const items = vi.mocked(confirmTaskPlanImport).mock.calls[0]?.[1].items;
  expect(items?.map((item) => item.assigneeId)).toEqual(["nigora", "feruza"]);
  expect(items?.map((item) => item.coAssigneeIds)).toEqual([["bakhtiyor", "temur"], ["bakhtiyor"]]);
  expect(items?.map((item) => item.dueAt)).toEqual([
    "2026-10-02T13:00:00.000Z", "2026-10-03T13:00:00.000Z",
  ]);
});

it("matches a full name from each table row without assigning an ambiguous name", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Plan", rows: [
      { title: "First task", source: "DOCX, таблица 1, строка 2", warning: null,
        assigneeHint: "Самугов Бахтиёр", coexecutorsHint: "Шокирова Феруза",
        groupKey: "DOCX, таблица 1, строка 2", dueDateHint: "2026-10-02" },
      { title: "Second task", source: "DOCX, таблица 1, строка 3", warning: null,
        assigneeHint: "Н. Каримбердиева", groupKey: "DOCX, таблица 1, строка 3" },
    ],
  });
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[
      { id: "me", name: "Автор плана", initials: "А", role: "manager", color: "blue", status: "active" },
      { id: "bakhtiyor", name: "Самугов Бахтиёр", initials: "Б", role: "manager", color: "blue", status: "active" },
      { id: "feruza", name: "Шокирова Феруза", initials: "Ф", role: "employee", color: "blue", status: "active" },
      { id: "nigora-1", name: "Каримбердиева Нигора", initials: "Н", role: "employee", color: "blue", status: "active" },
      { id: "nigora-2", name: "Каримбердиева Нилуфар", initials: "Н", role: "employee", color: "blue", status: "active" },
    ]} tasks={[]} onImported={vi.fn()} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["content"], "plan.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  await screen.findByDisplayValue("First task");
  const assignees = screen.getAllByLabelText("Ответственный / исполнитель");
  expect(assignees[0]).toHaveAttribute("value", "bakhtiyor");
  expect(assignees[1]).toHaveAttribute("value", "");
  expect(screen.getByText("Соисполнители: Шокирова Феруза")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("проверьте каждый включённый пункт");
  expect(confirmTaskPlanImport).not.toHaveBeenCalled();
});

it("does not silently assign a structured plan to the importer when the leader is unknown", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Weekly plan", rows: [{ title: "Plan activity", source: "DOCX, таблица 1, строка 2",
      warning: null, assigneeHint: "Н. Каримбердиева", coexecutorsHint: "Матбуот хизмати",
      groupKey: "DOCX, таблица 1, строка 2" }],
  });
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[
      { id: "me", name: "Автор плана", initials: "А", role: "manager", color: "blue", status: "active" },
    ]} tasks={[]} onImported={vi.fn()} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["content"], "weekly.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  await screen.findByText("В документе: Матбуот хизмати");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("проверьте каждый включённый пункт");
  expect(confirmTaskPlanImport).not.toHaveBeenCalled();
});

it("reviews the annual plan mapping and completes only an old green row", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Иш режа 2025", annualWorkPlan: true, rows: [
      { title: "Тадбирни ташкил этиш", source: "DOCX, таблица 1, строка 3", warning: null,
        assigneeHint: "Б. Мардаев", coexecutorsHint: "Б. Мардаев. Ф. Шокирова ҳудудий бўлинмалар",
        dueDateHint: "2025-03-31", deadlineText: "Март", mechanismItems: ["Режа тузиш"],
        completedWorkText: "Тадбир ўтказилди", greenCompletion: true,
        responsibleText: "Д. Лютфиддинов", executorsText: "Б. Мардаев. Ф. Шокирова ҳудудий бўлинмалар" },
      { title: "Мунтазам мониторинг", source: "DOCX, таблица 1, строка 4", warning: null,
        assigneeHint: "Б. Мардаев", executorsText: "Б. Мардаев", deadlineText: "Ҳар ойда",
        deadlineNeedsReview: true, mechanismItems: ["Ҳисобот бериш"] },
    ],
  });
  vi.mocked(confirmTaskPlanImport).mockResolvedValue({
    id: "plan-3", title: "Иш режа 2025", kind: "work", periodStart: null, periodEnd: null,
    taskIds: ["task-1", "task-2"], ownerUserId: "me", status: "active",
    createdByUserId: "me", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  });
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[
      { id: "me", name: "Автор плана", initials: "А", role: "manager", color: "blue", status: "active" },
      { id: "responsible", name: "Лютфиддинов Далер", initials: "Д", role: "employee", color: "blue", status: "active" },
      { id: "executor", name: "Мардаев Ботир", initials: "Б", role: "employee", color: "blue", status: "active" },
      { id: "co-executor", name: "Шокирова Феруза", initials: "Ф", role: "employee", color: "blue", status: "active" },
    ]} tasks={[]} onImported={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["content"], "annual.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  expect(await screen.findByText(/Прошедшие сроки исключаются/)).toBeInTheDocument();
  expect(screen.getByLabelText("Создать как завершённую (зелёный пункт, срок прошёл)"))
    .toBeChecked();
  expect(screen.getAllByLabelText("Основной исполнитель («Бажарувчи»)")[0]).toHaveAttribute(
    "value", "executor",
  );
  expect(screen.getByText("Наблюдатели («Масъул»): Лютфиддинов Далер")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Изменить наблюдателей пункта 1" }));
  expect(screen.getByLabelText("Наблюдатели пункта 1")).toHaveAttribute("value", "responsible");
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Проверьте исполнителей");
  fireEvent.click(screen.getByLabelText(/Я проверил исполнителей/));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  await waitFor(() => expect(confirmTaskPlanImport).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(confirmTaskPlanImport).mock.calls[0]?.[1];
  expect(payload?.annualWorkPlan).toBe(true);
  expect(payload?.items[0]).toMatchObject({
    assigneeId: "executor", coAssigneeIds: ["co-executor"], observerIds: ["responsible"],
    description: "Тадбир ўтказилди", checklist: ["Режа тузиш"], historicalCompleted: true,
  });
  expect(payload?.items[1]?.historicalCompleted).toBe(false);
  expect(payload?.items[1]?.description).toContain("Ҳар ойда");
});

it("does not promote a later annual executor when the first name is ambiguous", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Иш режа 2026", annualWorkPlan: true, rows: [{
      title: "Тадбирни ташкил этиш", source: "DOCX, таблица 1, строка 3", warning: null,
      assigneeHint: "Д. Лютфиддинов", executorsText: "Н. Каримбердиева; Б. Мардаев",
      responsibleText: "Д. Лютфиддинов",
    }],
  });
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[
      { id: "me", name: "Автор плана", initials: "А", role: "manager", color: "blue", status: "active" },
      { id: "nigora-1", name: "Каримбердиева Нигора", initials: "Н", role: "employee", color: "blue", status: "active" },
      { id: "nigora-2", name: "Каримбердиева Нилуфар", initials: "Н", role: "employee", color: "blue", status: "active" },
      { id: "executor", name: "Мардаев Ботир", initials: "Б", role: "employee", color: "blue", status: "active" },
      { id: "observer", name: "Лютфиддинов Далер", initials: "Д", role: "employee", color: "blue", status: "active" },
    ]} tasks={[]} onImported={vi.fn()} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["content"], "annual.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  expect(await screen.findByText("Соисполнители: Мардаев Ботир")).toBeInTheDocument();
  expect(screen.getByLabelText("Основной исполнитель («Бажарувчи»)")).toHaveAttribute("value", "");
  expect(screen.getByText("Наблюдатели («Масъул»): Лютфиддинов Далер")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Я проверил исполнителей/));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("проверьте каждый включённый пункт");
  expect(confirmTaskPlanImport).not.toHaveBeenCalled();
});
