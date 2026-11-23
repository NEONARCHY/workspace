import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";
import type { IncomingDocumentDetail, WorkspacePerson } from "@yuksalish/contracts";
import { workspaceTheme } from "./workspace-theme";
import { IncomingLettersView } from "./IncomingLettersView";
import { acceptWorkspaceTaskResult, assignIncomingDocument, downloadIncomingDocumentFile, loadEdoIncomingLetters, loadIncomingDocument, loadIncomingDocuments, submitWorkspaceTaskResult } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadIncomingDocuments: vi.fn(), loadIncomingDocument: vi.fn(), assignIncomingDocument: vi.fn(),
  downloadIncomingDocumentFile: vi.fn(), previewIncomingDocumentFile: vi.fn(),
  loadEdoIncomingLetters: vi.fn(), loadEdoIncomingLetter: vi.fn(), addEdoIncomingAssignment: vi.fn(),
  completeEdoIncomingLetter: vi.fn(), downloadEdoIncomingAttachment: vi.fn(), loadEdoIncomingOfficePreview: vi.fn(),
  submitWorkspaceTaskResult: vi.fn(), acceptWorkspaceTaskResult: vi.fn(), returnWorkspaceTaskForRevision: vi.fn(),
  uploadWorkspaceAttachment: vi.fn(), downloadWorkspaceAttachment: vi.fn(), loadOfficeFilePreview: vi.fn(),
}));
vi.mock("./AIReferentFiles", () => ({ saveReferentBlob: vi.fn() }));
vi.mock("./WorkspaceDateTimePicker", () => ({
  WorkspaceDateTimePicker: ({ value, onChange, ariaLabel, disabled }: {
    value: string; onChange: (value: string) => void; ariaLabel: string; disabled: boolean;
  }) => <input type="datetime-local" aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />,
}));

const people: readonly WorkspacePerson[] = [
  { id: "author", name: "Автор QA", initials: "А", role: "admin", color: "teal", status: "active" },
  { id: "executor", name: "Исполнитель QA", initials: "И", role: "employee", color: "blue", status: "active" },
  { id: "co", name: "Помощник QA", initials: "П", role: "employee", color: "teal", status: "active" },
];
const detail: IncomingDocumentDetail = {
  document: { id: "source", revision: 1, number: "QA-1", subject: "Подготовить ответ на письмо", sender: "Организация QA",
    receivedAt: "2026-11-23T05:00:00Z", source: "exat", filesExpected: true, execution: null, canAssign: true, canOpenTask: false },
  files: [{ id: "file", name: "original.pdf", byteSize: 1024, sha256: "a".repeat(64) }],
};
const assigned: IncomingDocumentDetail = { ...detail, document: { ...detail.document, canAssign: false, canOpenTask: true,
  execution: { taskId: "task", status: "new", dueAt: "2030-01-01T12:00:00Z", assigneeId: "executor", assigneeName: "Исполнитель QA", authorId: "author" } } };

function show(onOpenTask = vi.fn().mockResolvedValue(undefined), focusLetterId?: number) {
  render(<FluentProvider theme={workspaceTheme}><IncomingLettersView token="qa-token" people={people}
    currentUserId="author" canEdit canManageAccess onOpenTask={onOpenTask} focusLetterId={focusLetterId} /></FluentProvider>);
  return onOpenTask;
}

async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: /№ QA-1/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Назначить исполнение" }));
  fireEvent.change(screen.getByLabelText("Что нужно сделать"), { target: { value: "Подготовить официальный ответ" } });
  fireEvent.click(screen.getByRole("button", { name: "Основной исполнитель" }));
  fireEvent.click(await screen.findByRole("button", { name: /Исполнитель QA/ }));
  fireEvent.click(screen.getByRole("button", { name: "Добавить соисполнителя" }));
  fireEvent.click(await screen.findByRole("button", { name: /Помощник QA/ }));
  fireEvent.change(screen.getByLabelText("Срок исполнения"), { target: { value: "2030-01-01T17:00" } });
}

describe("Workspace incoming document workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadIncomingDocuments).mockResolvedValue({ documents: [detail.document], total: 1, offset: 0, limit: 30 });
    vi.mocked(loadIncomingDocument).mockResolvedValue(detail);
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 }, deadline_timezone_verified: false });
  });
  afterEach(cleanup);

  it("opens the local registry by default and preserves explicit legacy navigation", async () => {
    show();
    await screen.findByRole("button", { name: /№ QA-1/ });
    expect(loadEdoIncomingLetters).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Письма из ЭДО" }));
    await waitFor(() => expect(loadEdoIncomingLetters).toHaveBeenCalled());
  });

  it("creates only after confirmation and submits the reviewed people, deadline and source revision", async () => {
    const openTask = show();
    await openForm();
    expect(assignIncomingDocument).not.toHaveBeenCalled();
    vi.mocked(assignIncomingDocument).mockResolvedValue(assigned);
    fireEvent.click(screen.getByRole("button", { name: "Создать поручение" }));
    await screen.findByRole("button", { name: "Открыть поручение" });
    expect(assignIncomingDocument).toHaveBeenCalledWith("qa-token", "source", expect.objectContaining({
      expectedRevision: 1, instruction: "Подготовить официальный ответ", assigneeId: "executor", coAssigneeIds: ["co"],
      fileIds: ["file"],
      operationId: expect.any(String), dueAt: new Date("2030-01-01T17:00").toISOString(),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть поручение" }));
    await waitFor(() => expect(openTask).toHaveBeenCalledWith("task"));
  });

  it("retains the draft on failure and reconciles the source revision before retrying", async () => {
    show(); await openForm();
    vi.mocked(assignIncomingDocument).mockRejectedValueOnce(new Error("Временный сбой хранилища"));
    fireEvent.click(screen.getByRole("button", { name: "Создать поручение" }));
    await screen.findByText("Временный сбой хранилища");
    expect(screen.getByLabelText("Что нужно сделать")).toHaveValue("Подготовить официальный ответ");
    expect(screen.getByRole("button", { name: "Создать поручение" })).toBeDisabled();
    vi.mocked(loadIncomingDocument).mockResolvedValue({ ...detail, document: { ...detail.document, revision: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить состояние" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Создать поручение" })).toBeEnabled());
    expect(screen.getByLabelText("Что нужно сделать")).toHaveValue("Подготовить официальный ответ");
    vi.mocked(assignIncomingDocument).mockResolvedValue(assigned);
    fireEvent.click(screen.getByRole("button", { name: "Создать поручение" }));
    await screen.findByRole("button", { name: "Открыть поручение" });
    expect(vi.mocked(assignIncomingDocument).mock.calls[1]?.[2].expectedRevision).toBe(2);
  });

  it("blocks duplicate submissions while the first request is in flight", async () => {
    show(); await openForm();
    let finish: (value: IncomingDocumentDetail) => void = () => undefined;
    vi.mocked(assignIncomingDocument).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const form = screen.getByRole("form", { name: "Назначение исполнения" });
    fireEvent.submit(form); fireEvent.submit(form);
    expect(assignIncomingDocument).toHaveBeenCalledTimes(1);
    finish(assigned);
    await screen.findByRole("button", { name: "Открыть поручение" });
  });

  it("keeps unavailable actions hidden and blocks assignment until expected originals arrive", async () => {
    vi.mocked(loadIncomingDocument).mockResolvedValue({ ...detail, files: [] });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /№ QA-1/ }));
    expect(await screen.findByRole("button", { name: "Назначить исполнение" })).toBeDisabled();
    expect(assignIncomingDocument).not.toHaveBeenCalled();
  });

  it("does not leave loading stuck when search whitespace does not change the query", async () => {
    show();
    await screen.findByRole("button", { name: /№ QA-1/ });
    fireEvent.change(screen.getByPlaceholderText("Номер, тема или отправитель"), { target: { value: "   " } });
    await waitFor(() => expect(screen.getByRole("button", { name: /№ QA-1/ })).toBeVisible());
  });

  it("does not expose assignment when the server denies it", async () => {
    vi.mocked(loadIncomingDocument).mockResolvedValue({ ...detail, document: { ...detail.document, canAssign: false } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /№ QA-1/ }));
    await screen.findByText("Исполнение пока не назначено");
    expect(screen.queryByRole("button", { name: "Назначить исполнение" })).not.toBeInTheDocument();
    expect(assignIncomingDocument).not.toHaveBeenCalled();
  });

  it("shows the accepted report and material files directly without opening the task", async () => {
    const completed: IncomingDocumentDetail = { ...assigned,
      document: { ...assigned.document, execution: { ...assigned.document.execution!, status: "completed" } },
      executionDetail: { description: "Подготовить ответ", resultText: "Ответ согласован и направлен адресату.",
        coAssigneeIds: ["co"], latestReturn: null, canSubmit: false, canAccept: false, canReturn: false,
        files: [{ id: "report", ownerType: "task", ownerId: "task", fileName: "Ответ.pdf", contentType: "application/pdf",
          byteSize: 1200, documentRole: "general", sha256: "b".repeat(64), uploadedByUserId: "executor", createdAt: "2026-11-23T12:00:00Z" }] },
    };
    vi.mocked(loadIncomingDocument).mockResolvedValue(completed);
    const openTask = show();
    fireEvent.click(await screen.findByRole("button", { name: /№ QA-1/ }));
    expect(await screen.findByText("Ответ согласован и направлен адресату.")).toBeVisible();
    expect(screen.getByText("Ответ.pdf")).toBeVisible();
    expect(screen.getByText("Помощник QA")).toBeVisible();
    expect(screen.getByText("Принят постановщиком")).toBeVisible();
    expect(openTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Отправить на проверку" })).not.toBeInTheDocument();
  });

  it("keeps a failed report draft and reconciles before a protected retry", async () => {
    const working: IncomingDocumentDetail = { ...assigned, executionDetail: {
      description: "Инструкция", resultText: null, coAssigneeIds: [], latestReturn: null,
      files: [], canSubmit: true, canAccept: false, canReturn: false,
    } };
    vi.mocked(loadIncomingDocument).mockResolvedValue(working);
    show();
    fireEvent.click(await screen.findByRole("button", { name: /№ QA-1/ }));
    fireEvent.change(await screen.findByLabelText("Отчёт об исполнении"), { target: { value: "Готовый ответ" } });
    vi.mocked(submitWorkspaceTaskResult).mockRejectedValueOnce(new Error("Таймаут проверки"));
    const submit = screen.getByRole("button", { name: "Отправить на проверку" });
    fireEvent.click(submit); fireEvent.click(submit);
    await screen.findByText(/Таймаут проверки/);
    expect(submitWorkspaceTaskResult).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Отчёт об исполнении")).toHaveValue("Готовый ответ");
    fireEvent.click(screen.getByRole("button", { name: "Проверить состояние" }));
    await waitFor(() => expect(submit).toBeEnabled());
    vi.mocked(loadIncomingDocument).mockResolvedValue({ ...working,
      document: { ...working.document, execution: { ...working.document.execution!, status: "awaiting_review" } },
      executionDetail: { ...working.executionDetail!, resultText: "Готовый ответ", canSubmit: false },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText("Готовый ответ", { selector: "p" })).toBeVisible());
    expect(submitWorkspaceTaskResult).toHaveBeenLastCalledWith("qa-token", "task", "Готовый ответ");
  });

  it("accepts a submitted result in place with the existing protected action", async () => {
    const review: IncomingDocumentDetail = { ...assigned,
      document: { ...assigned.document, execution: { ...assigned.document.execution!, status: "awaiting_review" } },
      executionDetail: { description: "Инструкция", resultText: "Отчёт готов", coAssigneeIds: [], latestReturn: null,
        files: [], canSubmit: false, canAccept: true, canReturn: true },
    };
    vi.mocked(loadIncomingDocument).mockResolvedValue(review);
    const openTask = show();
    fireEvent.click(await screen.findByRole("button", { name: /№ QA-1/ }));
    const accept = await screen.findByRole("button", { name: "Принять результат" });
    vi.mocked(loadIncomingDocument).mockResolvedValue({ ...review,
      document: { ...review.document, execution: { ...review.document.execution!, status: "completed" } },
      executionDetail: { ...review.executionDetail!, canAccept: false, canReturn: false },
    });
    fireEvent.click(accept);
    await screen.findByText("Принят постановщиком");
    expect(acceptWorkspaceTaskResult).toHaveBeenCalledWith("qa-token", "task");
    expect(openTask).not.toHaveBeenCalled();
  });

  it("renders a text original as text inside the letter viewer", async () => {
    vi.mocked(loadIncomingDocument).mockResolvedValue({ ...detail, files: [{ ...detail.files[0]!, name: "Письмо.txt" }] });
    const content = "<script>Содержание письма</script>";
    // JSDOM's Blob omits the browser text() method.
    vi.mocked(downloadIncomingDocumentFile).mockResolvedValue(Object.assign(new Blob([content]), { text: async () => content }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: /№ QA-1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Открыть Письмо.txt" }));
    const viewer = await screen.findByRole("dialog");
    expect(await within(viewer).findByText("<script>Содержание письма</script>")).toBeVisible();
    expect(viewer.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
