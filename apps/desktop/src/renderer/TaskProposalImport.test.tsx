import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { TaskProposalImportContext, TaskProposalImportPreview, TaskProposalImportResult } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { TaskProposalImportDialog, TaskProposalImportLauncher } from "./TaskProposalImport";
import { ApiHttpError, loadTaskProposalImportContext, loadTaskProposalImportResult,
  previewTaskProposalImport, submitTaskProposalImport } from "./workspace-api";
import { people } from "./test-fixtures/demo-data";
import { importRowProblems, importTaskPayload, newImportDraft, suggestImportPerson } from "./task-proposal-import-review";

vi.mock("./workspace-api", () => ({
  ApiHttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
  loadTaskProposalImportContext: vi.fn(), loadTaskProposalImportResult: vi.fn(),
  previewTaskProposalImport: vi.fn(), submitTaskProposalImport: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const context: TaskProposalImportContext = { canImport: true, chairUserId: "chair", chairName: "Председатель теста", configurationError: null };
const preview: TaskProposalImportPreview = { sourceName: "synthetic.xlsx", rows: [{
  sourceKey: "Sheet!2", numberHint: "1", title: "Вымышленная задача", description: "Условия",
  assigneeHint: "Aniqlash kerak", coexecutorHints: [], dueDateHint: null, dueAtHint: null,
  deadlineText: "", note: "Исходное примечание", warnings: [],
}] };
const result: TaskProposalImportResult = { batchId: "batch", reused: false, proposals: [{
  id: "proposal", creatorUserId: "operator", authorUserId: "chair", status: "pending",
  task: { title: "Вымышленная задача" }, taskId: null, reason: "", createdAt: "2026-11-02T10:00:00Z", decidedAt: null,
  importBatchId: "batch", importSourceKey: "Sheet!2",
}] };

async function upload() {
  vi.mocked(previewTaskProposalImport).mockResolvedValue(preview);
  render(<FluentProvider theme={webLightTheme}><TaskProposalImportDialog token="test" people={people} tasks={[]}
    context={context} onClose={vi.fn()} /></FluentProvider>);
  fireEvent.change(screen.getByLabelText("Файл запросов Excel"), { target: { files: [new File(["test"], "synthetic.xlsx")] } });
  await screen.findByText("Кто указан в файле");
}

it("requires name review and sends pending proposals with unresolved assignee preserved", async () => {
  vi.mocked(submitTaskProposalImport).mockResolvedValue(result);
  await upload();
  expect(screen.getByRole("button", { name: "Отправить председателю · 1" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Я проверил сопоставления сотрудников" }));
  fireEvent.click(screen.getByRole("button", { name: "Отправить председателю · 1" }));
  await screen.findByText("Пакет сохранён");
  expect(submitTaskProposalImport).toHaveBeenCalledWith("test", expect.objectContaining({
    authorUserId: "chair", sourceName: "synthetic.xlsx", items: [expect.objectContaining({
      sourceKey: "Sheet!2", task: expect.objectContaining({ title: "Вымышленная задача", assigneeId: undefined,
        description: expect.stringContaining("Исходное примечание") }),
    })],
  }));
});

it("does not claim success after an unknown result and retries the identical request", async () => {
  vi.mocked(submitTaskProposalImport).mockRejectedValueOnce(new Error("Нет сети")).mockResolvedValueOnce(result);
  vi.mocked(loadTaskProposalImportResult).mockRejectedValue(new ApiHttpError(404, "Не найдено"));
  await upload();
  fireEvent.click(screen.getByRole("checkbox", { name: "Я проверил сопоставления сотрудников" }));
  fireEvent.click(screen.getByRole("button", { name: "Отправить председателю · 1" }));
  await screen.findByText(/Результат не подтверждён/);
  expect(screen.queryByText("Пакет сохранён")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Повторить тот же пакет" }));
  await screen.findByText("Пакет сохранён");
  expect(vi.mocked(submitTaskProposalImport).mock.calls[0]).toEqual(vi.mocked(submitTaskProposalImport).mock.calls[1]);
});

it("exposes no import action to ordinary users", async () => {
  vi.mocked(loadTaskProposalImportContext).mockResolvedValue({ ...context, canImport: false });
  render(<FluentProvider theme={webLightTheme}><TaskProposalImportLauncher token="employee" people={people} tasks={[]} /></FluentProvider>);
  await waitFor(() => expect(loadTaskProposalImportContext).toHaveBeenCalledWith("employee"));
  expect(screen.queryByRole("button", { name: "Импорт запросов" })).not.toBeInTheDocument();
});

it("preserves date-only source instead of inventing an hour and refuses ambiguous names", () => {
  const row = newImportDraft({ ...preview.rows[0]!, dueDateHint: "2031-01-02", deadlineText: "02.01.2031" });
  expect(row.dueAt).toBe("");
  expect(importRowProblems(row, {}, people, [])).toContain("Проверьте исходный срок");
  const reviewed = { ...row, deadlineAcknowledged: true };
  expect(importRowProblems(reviewed, {}, people, [])).toEqual([]);
  expect(importTaskPayload(reviewed, {}, "synthetic.xlsx").description).toContain("02.01.2031");
  const base = people[0]!;
  expect(suggestImportPerson("Умид", [{ ...base, id: "one", name: "Умид Первый" }, { ...base, id: "two", name: "Умид Второй" }])).toBe("");
});
