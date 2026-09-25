import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIReferentView } from "./AIReferentView";
import { AIReferentRecipientPicker } from "./AIReferentRecipientPicker";
import { referentDownloadName } from "./AIReferentFiles";
import { workspaceTheme } from "./workspace-theme";
import { actOnAIReferentLetter, checkAIReferentDocument, loadAIReferentLetter, loadAIReferentPacket, loadAIReferentIncomingRegistry, loadAIReferentRegistry, loadAIReferentReviewers, loadAIReferentRecipients, uploadWorkspaceAttachment } from "./workspace-api";
import type { AIReferentLetter } from "@yuksalish/contracts";

vi.mock("./workspace-api", () => ({
  actOnAIReferentLetter: vi.fn(),
  checkAIReferentDocument: vi.fn(),
  loadAIReferentDocumentCheck: vi.fn(),
  uploadAIReferentCommentAudio: vi.fn(),
  downloadAIReferentCommentAudio: vi.fn(),
  deleteAIReferentLetter: vi.fn(),
  createAIReferentLetter: vi.fn(),
  downloadAIReferentJournal: vi.fn(),
  downloadWorkspaceAttachment: vi.fn(),
  loadAIReferentRegistry: vi.fn(),
  loadAIReferentLetter: vi.fn(),
  loadAIReferentPacket: vi.fn(),
  downloadAIReferentPacket: vi.fn(),
  loadAIReferentReviewers: vi.fn(),
  loadAIReferentRecipients: vi.fn(),
  loadAIReferentIncomingRegistry: vi.fn(),
  updateAIReferentLetter: vi.fn(),
  uploadWorkspaceAttachment: vi.fn(),
}));

const registry = {
  totalCount: 1,
  pendingReviewCount: 1,
  readyCount: 0,
  sentCount: 0,
  signedCount: 0,
  letters: [{
    id: "letter-1",
    subject: "Ответ партнёру",
    recipientOrganization: "Организация-получатель",
    recipientAddress: "Канцелярия",
    route: "exat" as const,
    note: "",
    status: "pending_review" as const,
    workflowKind: "delivery" as const,
    source: "workspace" as const,
    createdByUserId: "user-1",
    createdByName: "Автор Письма",
    reviewerUserId: "user-2",
    reviewerName: "Согласующий",
    revision: 2,
    createdAt: "2026-09-22T08:00:00Z",
    updatedAt: "2026-09-22T09:00:00Z",
    attachments: [],
    events: [],
    availableActions: ["approve" as const, "return_for_revision" as const],
    canEdit: false,
  }],
};

const incomingRegistry = {
  totalCount: 1,
  filteredCount: 1,
  registeredCount: 1,
  attentionCount: 0,
  withAttachmentsCount: 1,
  lastSyncAt: "2026-09-22T10:00:00Z",
  journal: {
    available: true,
    fileName: "register.xlsx",
    updatedAt: "2026-09-22T10:00:00Z",
  },
  letters: [{
    id: "incoming-1",
    agentId: "referent-pc",
    externalId: "42",
    sequenceNumber: "000042",
    platformIncomingNumber: "0042/26/AI",
    senderLetterNumber: "17-04/88",
    receivedAt: "2026-09-22T08:00:00Z",
    senderOrganization: "Организация-отправитель",
    senderPerson: "Канцелярия",
    subject: "Входящее письмо",
    responsibleExternalId: "bobur",
    responsibleDisplayName: "Бобур",
    urgency: "normal",
    hasAttachments: true,
    attachmentsCount: 2,
    mainDocumentFilename: "letter.pdf",
    platformRecordId: "platform-42",
    status: "platform_submitted",
    fallbackUsed: false,
    errorMessage: "",
    source: "exat" as const,
    revision: 1,
    createdAt: "2026-09-22T08:00:00Z",
    updatedAt: "2026-09-22T09:00:00Z",
  }],
};

describe("AIReferentView", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAIReferentRegistry).mockResolvedValue(registry);
    vi.mocked(loadAIReferentIncomingRegistry).mockResolvedValue(incomingRegistry);
    const firstLetter = registry.letters[0];
    if (!firstLetter) throw new Error("Missing letter fixture");
    vi.mocked(loadAIReferentLetter).mockResolvedValue(firstLetter);
    vi.mocked(loadAIReferentReviewers).mockResolvedValue({ revision: 2, updatedAt: "2026-09-22T10:00:00Z",
      reviewers: [], runtimes: [] });
    vi.mocked(loadAIReferentRecipients).mockResolvedValue({
      entries: [{ id: "ministry-1", name: "Министерство финансов", categoryKey: "ministries",
        addresses: ["FIN-001"], route: "exat", addressBookOrganization: "Минфин" }],
      totalCount: 1, updatedAt: "2026-09-22T10:00:00Z",
    });
  });

  it("searches the shared address book and fills the selected destination", async () => {
    const onSelect = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><AIReferentRecipientPicker
      token="token" organization="" address="" onSelect={onSelect} onManualChange={vi.fn()}
    /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Открыть: поиск адресата" }));
    const search = screen.getByRole("textbox", { name: "Поиск адресата" });
    fireEvent.change(search, { target: { value: "финанс" } });
    await waitFor(() => expect(loadAIReferentRecipients).toHaveBeenCalledWith("token", expect.objectContaining({ query: "финанс" })));
    fireEvent.click(await screen.findByRole("button", { name: /Министерство финансов/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ addressBookOrganization: "Минфин", addresses: ["FIN-001"] }));
  });

  it("keeps manual address entry available when the catalog has not synced", async () => {
    vi.mocked(loadAIReferentRecipients).mockResolvedValue({ entries: [], totalCount: 0, updatedAt: null });
    const onManualChange = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><AIReferentRecipientPicker
      token="token" organization="" address="" onSelect={vi.fn()} onManualChange={onManualChange}
    /></FluentProvider>);
    expect(await screen.findByText("Справочник ещё не синхронизирован с ПК референта.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ввести вручную" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Организация-получатель" }), { target: { value: "Новый адресат" } });
    expect(onManualChange).toHaveBeenCalledWith("Новый адресат", "");
  });

  it("uses a readable Windows-safe packet name", () => {
    expect(referentDownloadName('0439/26-AI — Материалы: "Навои"', "zip"))
      .toBe("0439-26-AI — Материалы Навои.zip");
  });

  it("accepts dropped DOCX and blocks saving until the robot finishes", async () => {
    vi.mocked(checkAIReferentDocument).mockResolvedValue({ id: "check", status: "pending", reviewerKeys: [], detail: "" });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Новое письмо" }));
    const input = screen.getByLabelText("Выбрать основной документ DOCX");
    const zone = input.closest("label")!;
    const file = new File(["PK"], "Letter.docx");
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(checkAIReferentDocument).toHaveBeenCalledWith("token", file, "delivery"));
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeDisabled();
    expect(screen.getByText(/Подождите: робот проверяет/)).toBeInTheDocument();
    const attachment = new File(["PDF"], "Appendix.pdf");
    fireEvent.drop(screen.getByLabelText("Выбрать дополнительные вложения").closest("label")!, { dataTransfer: { files: [attachment] } });
    expect(screen.getByText("Appendix.pdf")).toBeInTheDocument();
  });

  it("shows failed checks, retries them and removes the checking message on success", async () => {
    vi.mocked(checkAIReferentDocument).mockResolvedValueOnce({ id: "check", status: "failed", reviewerKeys: [], detail: "Обратитесь к IT-специалисту." })
      .mockResolvedValueOnce({ id: "check", status: "passed", reviewerKeys: ["askar"], detail: "" });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Новое письмо" }));
    fireEvent.change(screen.getByLabelText("Выбрать основной документ DOCX"), { target: { files: [new File(["PK"], "letter.docx")] } });
    expect(await screen.findByText("Обратитесь к IT-специалисту.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeEnabled());
    expect(screen.queryByText(/Подождите: робот проверяет/)).not.toBeInTheDocument();
  });

  it("requires a preliminary reviewer for Bobur and does not wrap dropdowns in labels", async () => {
    vi.mocked(loadAIReferentReviewers).mockResolvedValue({ revision: 1, updatedAt: "2026-09-25", runtimes: [], reviewers: [
      { key: "bobur", userId: "bobur", username: "bobur", fullName: "Бобур", telegramId: null, enabled: true, canApprove: true, suggestedUsername: "bobur", label: "Бобур", accountActive: true },
      { key: "askar", userId: "askar", username: "askar", fullName: "Аскар", telegramId: null, enabled: true, canApprove: true, suggestedUsername: "askar", label: "Аскар", accountActive: true },
    ] });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Исходящие" }));
    await waitFor(() => expect(loadAIReferentReviewers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Новое письмо" }));
    const reviewer = screen.getByRole("combobox", { name: "Согласующий" });
    fireEvent.change(reviewer, { target: { value: "bobur" } });
    expect(screen.getByRole("combobox", { name: /Предварительный согласующий/ })).toHaveTextContent("Выберите предварительного согласующего");
    expect(screen.queryByRole("option", { name: "Только Бобур" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Канал отправки" }).closest("label")).toBeNull();
  });

  it("opens a notification target and requires a reason before returning a letter", async () => {
    vi.mocked(actOnAIReferentLetter).mockRejectedValue(new Error("Письмо уже изменилось"));
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate focusRequestId="letter-1" /></FluentProvider>);
    const comment = await screen.findByLabelText("Комментарий к решению");
    // JSDOM has no layout for Tabster's initial focus search; model the user's focus.
    comment.focus();
    const action = await screen.findByRole("button", { name: "Вернуть на доработку" });
    expect(action).toBeDisabled();
    fireEvent.change(comment, { target: { value: "Уточните адрес" } });
    fireEvent.click(action);
    await waitFor(() => expect(actOnAIReferentLetter).toHaveBeenCalledWith("token", expect.objectContaining({ id: "letter-1", revision: 2 }), "return_for_revision", "Уточните адрес", expect.any(String), undefined));
    expect(await screen.findAllByText("Письмо уже изменилось")).not.toHaveLength(0);
    expect(comment).toHaveValue("Уточните адрес");
  });

  it("lets an administrator replace the document without asking a reviewer again", async () => {
    const letter: AIReferentLetter = { ...registry.letters[0]!, status: "operator_revision",
      revision: 12, canReplaceDocument: true, canEdit: false, availableActions: [],
      displayNumber: "0441/26-AI" };
    vi.mocked(loadAIReferentLetter).mockResolvedValue(letter);
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate focusRequestId="letter-1" /></FluentProvider>);
    const input = await screen.findByLabelText("Новый документ администратора");
    input.focus();
    const pdf = new File(["%PDF-1.4 replacement"], "corrected.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    vi.mocked(loadAIReferentLetter).mockResolvedValue({ ...letter, revision: 13, availableActions: ["prepare_replacement"] });
    vi.mocked(uploadWorkspaceAttachment).mockResolvedValue({ id: "replacement", ownerType: "ai_referent_letter", ownerId: letter.id, fileName: pdf.name, contentType: pdf.type, byteSize: pdf.size, sha256: "a".repeat(64), documentRole: "primary", uploadedByUserId: "admin", createdAt: "2026-09-24T12:00:00Z" });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить замену" }));
    await waitFor(() => expect(uploadWorkspaceAttachment).toHaveBeenCalledWith("token", "ai_referent_letter", letter.id, pdf, "primary", undefined, 12));
    const apply = await screen.findByRole("button", { name: "Применить замену без согласования" });
    fireEvent.click(apply);
    expect(actOnAIReferentLetter).not.toHaveBeenCalled();
    vi.mocked(actOnAIReferentLetter).mockResolvedValue({ ...letter, revision: 14, status: "queued", availableActions: [], canReplaceDocument: false });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await waitFor(() => expect(actOnAIReferentLetter).toHaveBeenCalledWith("token", expect.objectContaining({ revision: 13 }), "prepare_replacement", "", expect.any(String), undefined));
    expect(screen.queryByRole("button", { name: "Отправить на согласование" })).not.toBeInTheDocument();
  });

  it("opens the incoming packet and offers retry without pretending files exist", async () => {
    vi.mocked(loadAIReferentPacket).mockRejectedValueOnce(new Error("Хранилище недоступно"))
      .mockResolvedValue({ files: [] });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    const opener = await screen.findByRole("button", { name: "Пакет документов" });
    opener.focus();
    fireEvent.click(opener);
    (await screen.findByLabelText("Закрыть пакет")).focus();
    expect(await screen.findByText("Хранилище недоступно")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Скачать пакет ZIP" })).toBeDisabled();
    const packet = await screen.findByRole("dialog", { name: "Пакет документов" });
    fireEvent.click(await within(packet).findByRole("button", { name: "Обновить" }));
    expect(await screen.findByText("Робот ещё не передал файлы этого письма.")).toBeInTheDocument();
    expect(loadAIReferentPacket).toHaveBeenLastCalledWith("token", "incoming", "incoming-1");
  });

  it("shows incoming letters from the robot and keeps the outgoing register available", async () => {
    render(
      <FluentProvider theme={workspaceTheme}>
        <AIReferentView token="token" people={[]} canCreate />
      </FluentProvider>,
    );

    expect(screen.getByRole("heading", { name: "AI Referent" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Входящее письмо")).toBeInTheDocument());
    expect(screen.getByText(/Организация-отправитель · Ответственный:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excel-журнал/ })).toBeEnabled();
    const incomingRefresh = screen.getByRole("button", { name: "Обновить" });
    expect(incomingRefresh.closest(".ai-referent-toolbar-actions")).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Исходящие" }));
    await waitFor(() => expect(screen.getByText("Ответ партнёру")).toBeInTheDocument());
    expect(screen.getByText("Организация-получатель")).toBeInTheDocument();
    expect(screen.getAllByText("На согласовании")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: /Новое письмо/ })).toBeEnabled();
    const outgoingRefresh = screen.getByRole("button", { name: "Обновить" });
    expect(outgoingRefresh.closest(".ai-referent-toolbar-actions")).not.toBeNull();
    expect(outgoingRefresh.closest(".ai-referent-header-actions")).toBeNull();
  });

  it("uses the summary cards as the only incoming filters and keeps their totals stable", async () => {
    vi.mocked(loadAIReferentIncomingRegistry).mockImplementation(async (_token, options) => ({
      ...incomingRegistry,
      letters: options?.category === "attention" ? [] : incomingRegistry.letters,
      filteredCount: options?.category === "attention" ? 0 : 1,
    }));
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    const totalCard = await screen.findByRole("button", { name: /всего входящих/ });
    await waitFor(() => expect(totalCard).toHaveTextContent("1"));
    expect(screen.queryByRole("button", { name: "Все" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /требуют внимания/ }));
    await waitFor(() => expect(loadAIReferentIncomingRegistry).toHaveBeenCalledWith(
      "token", expect.objectContaining({ category: "attention" }),
    ));
    expect(totalCard).toHaveTextContent("1");
    expect(screen.getByText("Страница 1 · Найдено 0")).toBeInTheDocument();
  });

  it("prioritizes the signed letter and keeps attachments inside the packet", async () => {
    vi.mocked(loadAIReferentPacket).mockResolvedValue({ files: [] });
    const attachment = {
      id: "original-1", ownerType: "ai_referent_letter" as const,
      ownerId: "letter-1", fileName: "unsigned.docx", contentType: "application/docx",
      byteSize: 1024, sha256: "a".repeat(64), documentRole: "primary" as const,
      uploadedByUserId: "user-1", createdAt: "2026-09-22T08:00:00Z",
    };
    vi.mocked(loadAIReferentLetter).mockResolvedValue({
      ...registry.letters[0]!, finalPdfFileId: "signed-1", attachments: [attachment],
    });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate focusRequestId="letter-1" /></FluentProvider>);
    const detail = await screen.findByRole("dialog", { name: /Ответ партнёру/ });
    expect(within(detail).getByRole("button", { name: "Скачать подписанное письмо" })).toBeInTheDocument();
    expect(within(detail).queryByText("unsigned.docx")).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("tab", { name: /Документы/ }));
    fireEvent.click(within(detail).getByRole("button", { name: "Пакет документов" }));
    const packet = await screen.findByRole("dialog", { name: "Пакет документов" });
    expect(within(packet).getByText("Организация-получатель")).toBeInTheDocument();
    expect(within(packet).queryByText("unsigned.docx")).not.toBeInTheDocument();
  });

  it("creates a sign-only request without delivery controls", async () => {
    render(<FluentProvider theme={workspaceTheme}>
      <AIReferentView token="token" people={[]} canCreate />
    </FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "На подпись" }));
    const dialog = await screen.findByRole("dialog", { name: "Подписать без отправки" });
    expect(within(dialog).getByText(/каждый лист отдельным подписанным PDF/)).toBeInTheDocument();
    expect(within(dialog).queryByText("Канал отправки")).toBeNull();
    expect(within(dialog).queryByText("Второй согласующий (необязательно)")).toBeNull();
    expect(within(dialog).queryByText("Кому отправить")).toBeNull();
  });
});
