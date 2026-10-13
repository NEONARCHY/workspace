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
    taskIds: ["task-1"], createdByUserId: "me", createdAt: "2026-01-01T00:00:00Z",
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
  fireEvent.change(secondAction, { target: { value: "skip" } });
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  await waitFor(() => expect(confirmTaskPlanImport).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(confirmTaskPlanImport).mock.calls[0]?.[1];
  if (!payload) throw new Error("Import confirmation was not sent");
  expect(payload.items).toHaveLength(1);
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

it("uses the weekly leader for both columns and applies reviewed row co-assignees", async () => {
  vi.mocked(previewTaskPlanImport).mockResolvedValue({
    suggestedTitle: "Weekly plan", rows: [
      { title: "Manager activity", source: "DOCX, таблица 1, строка 2, столбец 3", warning: null,
        assigneeHint: "Н. Каримбердиева", coexecutorsHint: "Б. Самугов; Матбуот хизмати",
        groupKey: "DOCX, таблица 1, строка 2" },
      { title: "Specialist activity", source: "DOCX, таблица 1, строка 2, столбец 4", warning: null,
        assigneeHint: "Н. Каримбердиева", coexecutorsHint: "Б. Самугов; Матбуот хизмати",
        groupKey: "DOCX, таблица 1, строка 2" },
    ],
  });
  vi.mocked(confirmTaskPlanImport).mockResolvedValue({
    id: "plan-2", title: "Weekly plan", kind: "work", periodStart: null, periodEnd: null,
    taskIds: ["task-1", "task-2"], createdByUserId: "me", createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  render(<FluentProvider theme={webLightTheme}><TaskPlanImportView
    token="token" currentUserId="me" people={[
      { id: "me", name: "Автор плана", initials: "А", role: "manager", color: "blue", status: "active" },
      { id: "nigora", name: "Каримбердиева Нигора", initials: "Н", role: "manager", color: "blue", status: "active" },
      { id: "bakhtiyor", name: "Самугов Бахтиёр", initials: "Б", role: "employee", color: "blue", status: "active" },
    ]} tasks={[]} onImported={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />
  </FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл плана"), {
    target: { files: [new File(["content"], "weekly.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Разобрать документ" }));
  expect(await screen.findByText("В документе: Б. Самугов; Матбуот хизмати")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Проверьте ответственного");
  expect(confirmTaskPlanImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить и создать план" }));
  await waitFor(() => expect(confirmTaskPlanImport).toHaveBeenCalledTimes(1));
  const items = vi.mocked(confirmTaskPlanImport).mock.calls[0]?.[1].items;
  expect(items?.map((item) => item.assigneeId)).toEqual(["nigora", "nigora"]);
  expect(items?.map((item) => item.coAssigneeIds)).toEqual([["bakhtiyor"], ["bakhtiyor"]]);
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
