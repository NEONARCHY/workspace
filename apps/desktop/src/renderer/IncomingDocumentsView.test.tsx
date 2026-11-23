import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";
import type { IncomingDocumentDetail, WorkspacePerson } from "@yuksalish/contracts";
import { workspaceTheme } from "./workspace-theme";
import { IncomingLettersView } from "./IncomingLettersView";
import { assignIncomingDocument, loadEdoIncomingLetters, loadIncomingDocument, loadIncomingDocuments } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadIncomingDocuments: vi.fn(), loadIncomingDocument: vi.fn(), assignIncomingDocument: vi.fn(),
  downloadIncomingDocumentFile: vi.fn(), previewIncomingDocumentFile: vi.fn(),
  loadEdoIncomingLetters: vi.fn(), loadEdoIncomingLetter: vi.fn(), addEdoIncomingAssignment: vi.fn(),
  completeEdoIncomingLetter: vi.fn(), downloadEdoIncomingAttachment: vi.fn(), loadEdoIncomingOfficePreview: vi.fn(),
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
});
