import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDocumentImport } from "@yuksalish/contracts";
import { ProjectImportDialog } from "./ProjectImportDialog";
import { people } from "./test-fixtures/demo-data";
import { workspaceTheme } from "./workspace-theme";
import {
  analyzeProjectImport, createProjectImport, loadProjectImport, loadProjectImports,
  publishProjectImport, reviewProjectImport, uploadProjectImportDocument,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  analyzeProjectImport: vi.fn(), createProjectImport: vi.fn(),
  loadProjectImport: vi.fn(), loadProjectImports: vi.fn(),
  publishProjectImport: vi.fn(), reviewProjectImport: vi.fn(),
  uploadProjectImportDocument: vi.fn(), downloadProjectImportDocument: vi.fn(),
}));
const draft: ProjectDocumentImport = {
  id: "import-1", state: "draft", revision: 1, documents: [],
  content: {
    templateVersion: 1, project: { title: "ALDA", code: "ALDA", description: "", budget: "1000",
      currency: "UZS", startDate: null, endDate: null, scope: "yuksalish", donor: "", partners: "", sources: [] },
    directions: [], budgetLines: [],
    issues: [{ message: "Сверьте даты", resolution: "", sources: [] }],
  },
  projectId: null, error: null, updatedAt: "2026-10-09T10:00:00Z",
};
const ready: ProjectDocumentImport = { ...draft, state: "ready", revision: 5 };
const onClose = vi.fn();
const onCreated = vi.fn();
function setup(projectId?: string) {
  return render(<FluentProvider theme={workspaceTheme}><ProjectImportDialog token="test"
    currentUserId={people[0]!.id} people={people} projectId={projectId}
    onClose={onClose} onCreated={onCreated} /></FluentProvider>);
}
async function selectReady() {
  vi.mocked(loadProjectImports).mockResolvedValue([ready]);
  setup();
  fireEvent.click(screen.getByRole("combobox", { name: "Сохранённый импорт" }));
  fireEvent.click(await screen.findByRole("option", { name: "ALDA · ready" }));
}
beforeEach(() => {
  vi.mocked(loadProjectImports).mockResolvedValue([]);
  vi.mocked(createProjectImport).mockResolvedValue(draft);
  vi.mocked(uploadProjectImportDocument).mockResolvedValue({ ...draft, revision: 2, documents: [
    { id: "doc-1", name: "concept.txt", size: 4, sha256: "test", mimeType: "text/plain" },
  ] });
  vi.mocked(analyzeProjectImport).mockResolvedValue({ ...draft, state: "queued", revision: 3 });
  vi.mocked(loadProjectImport).mockResolvedValue(ready);
  vi.mocked(publishProjectImport).mockResolvedValue({ ...ready, state: "published", projectId: "project-1" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("reviewed project document import", () => {
  it("requires consent and never creates a project during upload or analysis", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Документы проекта"), { target: { files: [
      new File(["data"], "concept.txt", { type: "text/plain" }),
    ] } });
    expect(screen.getByRole("button", { name: "Разобрать документы" })).toBeDisabled();
    expect(createProjectImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Разрешаю передать/ }));
    fireEvent.click(screen.getByRole("button", { name: "Разобрать документы" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ожидают обработки");
    expect(uploadProjectImportDocument).toHaveBeenCalledTimes(1);
    expect(publishProjectImport).not.toHaveBeenCalled();
  });
  it("keeps unresolved conflicts blocked and saves review before confirmation", async () => {
    await selectReady();
    expect(screen.getByRole("button", { name: "Создать проект" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Проверка" }));
    fireEvent.change(screen.getByLabelText("Решение"), { target: { value: "Берём подписанный план" } });
    expect(screen.getByRole("checkbox", { name: /Проверил сохранённый/ })).toBeDisabled();
    vi.mocked(reviewProjectImport).mockImplementation(async (_, current, content) => ({
      ...current, revision: current.revision + 1, content,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить проверку" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Проверил сохранённый/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: /Проверил сохранённый/ }));
    fireEvent.click(screen.getByRole("button", { name: "Создать проект" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("project-1"));
    expect(publishProjectImport).toHaveBeenCalledWith("test", "import-1", expect.objectContaining({
      expectedRevision: 6, managerUserId: people[0]!.id, reviewed: true, accessStatus: "closed",
    }));
  });
  it("preserves edits after a failed save and guards accidental closing", async () => {
    await selectReady();
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Уточнённый проект" } });
    vi.mocked(reviewProjectImport).mockRejectedValue(new Error("Сервер недоступен"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить проверку" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
    expect(screen.getByLabelText("Название")).toHaveValue("Уточнённый проект");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть импорт" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отменить правки" }));
    expect(screen.getByLabelText("Название")).toHaveValue("ALDA");
  });
  it("opens a published source archive without permitting another publication", async () => {
    vi.mocked(loadProjectImports).mockResolvedValue([{ ...ready, state: "published", projectId: "project-1" }]);
    setup("project-1");
    const dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(dialog.getByLabelText("Название")).toBeDisabled());
    expect(dialog.queryByRole("button", { name: "Создать проект" })).not.toBeInTheDocument();
    expect(publishProjectImport).not.toHaveBeenCalled();
  });
});
