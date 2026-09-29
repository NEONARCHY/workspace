import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIReferentView } from "./AIReferentView";
import { AIReferentRecipientPicker } from "./AIReferentRecipientPicker";
import { referentDownloadName } from "./AIReferentFiles";
import { workspaceTheme } from "./workspace-theme";
import { actOnAIReferentLetter, addAIReferentManualRecipient, createAIReferentLetter, checkAIReferentDocument, loadAIReferentAuthority, loadAIReferentLetter, loadAIReferentPacket, loadAIReferentIncomingRegistry, loadAIReferentRegistry, loadAIReferentReviewers, loadAIReferentRecipients, loadAIReferentManualRecipients, updateAIReferentLetter, uploadWorkspaceAttachment } from "./workspace-api";
import type { AIReferentLetter } from "@yuksalish/contracts";

vi.mock("./workspace-api", () => ({
  actOnAIReferentLetter: vi.fn(),
  addAIReferentManualRecipient: vi.fn(),
  checkAIReferentDocument: vi.fn(),
  loadAIReferentDocumentCheck: vi.fn(),
  uploadAIReferentCommentAudio: vi.fn(),
  downloadAIReferentCommentAudio: vi.fn(),
  deleteAIReferentLetter: vi.fn(),
  createAIReferentLetter: vi.fn(),
  downloadAIReferentJournal: vi.fn(),
  downloadWorkspaceAttachment: vi.fn(),
  loadAIReferentRegistry: vi.fn(),
  loadAIReferentAuthority: vi.fn(),
  loadAIReferentLetter: vi.fn(),
  loadAIReferentPacket: vi.fn(),
  downloadAIReferentPacket: vi.fn(),
  loadAIReferentReviewers: vi.fn(),
  loadAIReferentRecipients: vi.fn(),
  loadAIReferentManualRecipients: vi.fn(),
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

const reviewerCatalog = {
  revision: 1, updatedAt: "2026-09-29", runtimes: [], reviewers: [
    { key: "umid" as const, userId: "user-2", username: "umid", fullName: "Умид Ражабов", telegramId: null, enabled: true, canApprove: true, suggestedUsername: "umid", label: "Умид", accountActive: true },
  ],
};

const readyDraft: AIReferentLetter = {
  ...registry.letters[0]!, status: "draft", revision: 3, canEdit: true,
  recipientAddress: "office@example.test", route: "webmail",
  availableActions: ["submit", "cancel"],
  documentCheck: { id: "check", status: "passed", reviewerKeys: ["umid"], detail: "" },
};

async function openComposer() {
  fireEvent.click(await screen.findByRole("button", { name: "Новое письмо" }));
  // JSDOM has no layout for Tabster's initial focus search. Model real focus.
  const subject = await screen.findByPlaceholderText("Если пропустить — исходящий номер");
  act(() => subject.focus());
}

async function focusSavedDetail() {
  await waitFor(() => expect(document.querySelector(".ai-referent-form-dialog")).toBeNull());
  const button = await waitFor(() => {
    const target = document.querySelector<HTMLButtonElement>(".ai-referent-detail-actions button");
    expect(target).not.toBeNull();
    return target!;
  });
  act(() => button.focus());
}

describe("AIReferentView", () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAIReferentDocument).mockReset();
    vi.mocked(loadAIReferentAuthority).mockResolvedValue({ writable: true, mode: "legacy", leaseUntil: null, detail: "" });
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
    vi.mocked(loadAIReferentManualRecipients).mockResolvedValue([]);
    vi.mocked(addAIReferentManualRecipient).mockResolvedValue({ id: "manual-new", name: "Новый адресат", addresses: ["office@example.org"], route: "webmail", categoryKey: "other", addressBookOrganization: "Новый адресат" });
  });

  it("shows the address-book manager only to administrators", async () => {
    const view = render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    expect(screen.queryByRole("tab", { name: "Адресная книга" })).not.toBeInTheDocument();
    view.unmount();
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate canAdmin /></FluentProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Адресная книга" }));
    expect(await screen.findByText("Пока нет добавленных адресов. Справочник робота продолжает работать как прежде.")).toBeInTheDocument();
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

  it("asks before sharing a manually entered address and keeps the draft local when declined", async () => {
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: "Ввести вручную" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Организация-получатель" }), { target: { value: "Новый адресат" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес или получатель" }), { target: { value: "office@example.org" } });
    expect(screen.getByRole("group", { name: "Сохранение нового адресата" })).toHaveTextContent("Сохранить введённый адрес в справочник?");
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Нет, только для письма" }));
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeEnabled();
    expect(addAIReferentManualRecipient).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес или получатель" }), { target: { value: "new@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Да, сохранить для всех" }));
    await waitFor(() => expect(addAIReferentManualRecipient).toHaveBeenCalledWith("token", { name: "Новый адресат", address: "new@example.org", categoryKey: "other" }));
    expect(await screen.findByText("Адрес сохранён в общем справочнике.")).toBeInTheDocument();
  });

  it("keeps the sharing decision open after a server error without claiming the address was saved", async () => {
    vi.mocked(addAIReferentManualRecipient).mockRejectedValue(new Error("Справочник временно недоступен"));
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: "Ввести вручную" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Организация-получатель" }), { target: { value: "Новый адресат" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес или получатель" }), { target: { value: "office@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Да, сохранить для всех" }));
    expect(await screen.findByText("Справочник временно недоступен")).toHaveAttribute("role", "alert");
    expect(screen.queryByText("Адрес сохранён в общем справочнике.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Нет, только для письма" }));
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeEnabled();
  });

  it("uses a readable Windows-safe packet name", () => {
    expect(referentDownloadName('0439/26-AI — Материалы: "Навои"', "zip"))
      .toBe("0439-26-AI — Материалы Навои.zip");
  });

  it("keeps AI Referent view-only after the bot lease expires", async () => {
    vi.mocked(loadAIReferentAuthority).mockResolvedValue({
      writable: false, mode: "replay_required", leaseUntil: "2026-09-25T10:00:00Z",
      detail: "Связь с роботом потеряна. Доступен только просмотр.",
    });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView
      token="token" people={[]} canCreate focusRequestId="letter-1"
    /></FluentProvider>);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Доступен только просмотр"));
    expect(screen.queryByRole("button", { name: "Новое письмо" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Согласовать" })).not.toBeInTheDocument();
    expect(actOnAIReferentLetter).not.toHaveBeenCalled();
  });

  it("accepts dropped DOCX and blocks saving until the robot finishes", async () => {
    vi.mocked(checkAIReferentDocument).mockResolvedValue({ id: "check", status: "pending", reviewerKeys: [], detail: "" });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    await openComposer();
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
    fireEvent.change(screen.getByLabelText("Заменить вложение Appendix.pdf"), { target: { files: [new File(["PDF"], "Revised.pdf")] } });
    expect(screen.getByText("Revised.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Удалить вложение Revised.pdf" }));
    expect(screen.queryByText("Revised.pdf")).not.toBeInTheDocument();
  });

  it("shows failed checks, retries them and removes the checking message on success", async () => {
    vi.mocked(checkAIReferentDocument).mockResolvedValueOnce({ id: "check", status: "failed", reviewerKeys: [], detail: "Обратитесь к IT-специалисту." })
      .mockResolvedValueOnce({ id: "check", status: "passed", reviewerKeys: ["askar"], detail: "" });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    await openComposer();
    fireEvent.change(screen.getByLabelText("Выбрать основной документ DOCX"), { target: { files: [new File(["PK"], "letter.docx")] } });
    expect(await screen.findByText("Обратитесь к IT-специалисту.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    await waitFor(() => expect(checkAIReferentDocument).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeEnabled(), { timeout: 5000 });
    expect(screen.queryByText(/Подождите: робот проверяет/)).not.toBeInTheDocument();
    expect(screen.getByText("С письмом всё в порядке.")).toBeInTheDocument();
  });

  it("keeps a valid DOCX as draft but blocks a mismatching signer", async () => {
    vi.mocked(loadAIReferentReviewers).mockResolvedValue(reviewerCatalog);
    vi.mocked(checkAIReferentDocument).mockResolvedValue({ id: "check", status: "passed", reviewerKeys: ["askar"], detail: "" });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    await openComposer();
    const reviewer = screen.getByRole("combobox", { name: "Согласующий" });
    await waitFor(() => expect(reviewer).toBeEnabled());
    fireEvent.change(reviewer, { target: { value: "user-2" } });
    fireEvent.change(screen.getByLabelText("Выбрать основной документ DOCX"), { target: { files: [new File(["PK"], "askar.docx")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("В DOCX не найдено место для подписи выбранного руководителя.");
    expect(screen.queryByText("С письмом всё в порядке.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить на согласование" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сохранить черновик" })).toBeEnabled();
    expect(actOnAIReferentLetter).not.toHaveBeenCalled();
  });

  it("loads reviewers from Incoming, reports failure and retries without changing tabs", async () => {
    vi.mocked(loadAIReferentReviewers).mockRejectedValue(new Error("Список временно недоступен"));
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    await openComposer();
    expect(await screen.findByText("Список временно недоступен")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Согласующий" })).toBeDisabled();
    vi.mocked(loadAIReferentReviewers).mockResolvedValue(reviewerCatalog);
    fireEvent.click(screen.getByRole("button", { name: "Обновить согласующих" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Согласующий" })).toBeEnabled());
    const reviewer = screen.getByRole("combobox", { name: "Согласующий" });
    // Popup focus/layout is exercised in the real-browser smoke test.
    fireEvent.change(reviewer, { target: { value: "user-2" } });
    expect(reviewer).toHaveTextContent("Умид Ражабов");
  });

  it.each([["office@example.test", "Webmail", "E-XAT"], ["  office@EXAT.UZ  ", "E-XAT", "Webmail"]])(
    "locks the channel to recipient %s",
    async (address, selectedChannel, forbiddenChannel) => {
      render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
      await openComposer();
      fireEvent.click(await screen.findByRole("button", { name: "Ввести вручную" }));
      fireEvent.change(await screen.findByRole("textbox", { name: "Адрес или получатель" }), { target: { value: address } });
      const channel = screen.getByRole("combobox", { name: "Канал отправки" });
      expect(channel).toHaveTextContent(selectedChannel);
      fireEvent.change(channel, { target: { value: forbiddenChannel === "E-XAT" ? "exat" : "webmail" } });
      expect(channel).toHaveTextContent(selectedChannel);
    },
  );

  it.each(["draft", "submit", "submit-error"])("saves documents before optional submission (%s)", async (mode) => {
    const submit = mode !== "draft";
    vi.mocked(loadAIReferentReviewers).mockResolvedValue(reviewerCatalog);
    vi.mocked(checkAIReferentDocument).mockResolvedValue(readyDraft.documentCheck!);
    vi.mocked(createAIReferentLetter).mockResolvedValue({ ...readyDraft, revision: 1 });
    vi.mocked(loadAIReferentLetter).mockResolvedValue(readyDraft);
    vi.mocked(actOnAIReferentLetter).mockResolvedValue({ ...readyDraft, status: "pending_review", canEdit: false, availableActions: [], revision: 4 });
    if (mode === "submit-error") vi.mocked(actOnAIReferentLetter).mockRejectedValue(new Error("Согласование временно недоступно"));
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    await openComposer();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Согласующий" })).toBeEnabled());
    fireEvent.click(await screen.findByRole("button", { name: "Ввести вручную" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Организация-получатель" }), { target: { value: "Партнёр" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес или получатель" }), { target: { value: "office@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Нет, только для письма" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Согласующий" }), { target: { value: "user-2" } });
    const file = new File(["PK"], "letter.docx");
    fireEvent.change(screen.getByLabelText("Выбрать основной документ DOCX"), { target: { files: [file] } });
    const attachment = new File(["PDF"], "appendix.pdf");
    fireEvent.change(screen.getByLabelText("Выбрать дополнительные вложения"), { target: { files: [attachment] } });
    await screen.findByText("С письмом всё в порядке.");
    const action = await screen.findByRole("button", { name: submit ? "Отправить на согласование" : "Сохранить черновик" });
    fireEvent.click(action);
    fireEvent.click(action);
    await waitFor(() => expect(uploadWorkspaceAttachment).toHaveBeenCalledTimes(2));
    expect(createAIReferentLetter).toHaveBeenCalledTimes(1);
    expect(createAIReferentLetter).toHaveBeenCalledWith("token", expect.objectContaining({ route: "webmail", reviewerUserId: "user-2", recipientAddress: "office@example.test" }));
    if (submit) {
      await waitFor(() => expect(actOnAIReferentLetter).toHaveBeenCalledTimes(1));
      expect(actOnAIReferentLetter).toHaveBeenCalledWith("token", expect.objectContaining({ revision: 3 }), "submit", "", expect.any(String));
      expect(vi.mocked(uploadWorkspaceAttachment).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(actOnAIReferentLetter).mock.invocationCallOrder[0]!);
      if (mode === "submit-error") {
        expect(await screen.findAllByText("Согласование временно недоступно")).not.toHaveLength(0);
        await focusSavedDetail();
        expect(screen.getByRole("button", { name: "Редактировать" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Отправить на согласование" })).toBeEnabled();
      }
    } else {
      await focusSavedDetail();
      await screen.findByRole("button", { name: "Редактировать" });
      expect(actOnAIReferentLetter).not.toHaveBeenCalled();
    }
  });

  it("explains a blocked draft and keeps submission unavailable without bypassing preflight", async () => {
    const letter = { ...readyDraft, availableActions: ["cancel"] as const, submissionBlockReason: "В DOCX нет подписи выбранного руководителя." };
    vi.mocked(loadAIReferentLetter).mockResolvedValue(letter);
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate focusRequestId="letter-1" /></FluentProvider>);
    expect(await screen.findByText(letter.submissionBlockReason)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить на согласование" })).toBeDisabled();
    for (const tab of ["Документы · 0", "История · 0", "Обзор"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(screen.getByRole("button", { name: "Редактировать" }).closest(".ai-referent-detail-content")).toBeNull();
    }
    expect(actOnAIReferentLetter).not.toHaveBeenCalled();
  });

  it.each([false, true])("shows stored documents in edit mode without reuploading them (replace=%s)", async (replace) => {
    const letter: AIReferentLetter = { ...readyDraft, attachments: [
      { id: "primary", ownerId: readyDraft.id, ownerType: "ai_referent_letter", fileName: "Saved.docx", contentType: "application/octet-stream", byteSize: 50, sha256: "hash", uploadedByUserId: "user-1", documentRole: "primary", createdAt: readyDraft.createdAt },
      { id: "additional", ownerId: readyDraft.id, ownerType: "ai_referent_letter", fileName: "Appendix.pdf", contentType: "application/pdf", byteSize: 50, sha256: "hash2", uploadedByUserId: "user-1", documentRole: "additional", createdAt: readyDraft.createdAt },
    ] };
    vi.mocked(loadAIReferentReviewers).mockResolvedValue(reviewerCatalog);
    vi.mocked(loadAIReferentLetter).mockResolvedValue(letter);
    vi.mocked(updateAIReferentLetter).mockResolvedValue(letter);
    vi.mocked(checkAIReferentDocument).mockResolvedValue(readyDraft.documentCheck!);
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate focusRequestId="letter-1" /></FluentProvider>);
    const edit = await screen.findByRole("button", { name: "Редактировать" });
    act(() => edit.focus());
    fireEvent.click(edit);
    const subject = await screen.findByPlaceholderText("Если пропустить — исходящий номер");
    act(() => subject.focus());
    expect(within(screen.getByRole("list", { name: "Сохранённое письмо" })).getByText("Saved.docx")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Сохранённые вложения" })).getByText("Appendix.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать Saved.docx" })).toBeEnabled();
    const file = new File(["PK"], "Replacement.docx");
    if (replace) {
      fireEvent.change(screen.getByLabelText("Выбрать основной документ DOCX"), { target: { files: [file] } });
      await screen.findByText("С письмом всё в порядке.");
      expect(screen.getByText("Будет заменено выбранным DOCX после сохранения.")).toBeInTheDocument();
    }
    fireEvent.change(subject, { target: { value: "Updated subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await waitFor(() => expect(updateAIReferentLetter).toHaveBeenCalledWith("token", "letter-1", expect.objectContaining({ subject: "Updated subject" }), 3));
    await focusSavedDetail();
    await screen.findByRole("button", { name: "Редактировать" });
    expect(uploadWorkspaceAttachment).toHaveBeenCalledTimes(replace ? 1 : 0);
    if (replace) expect(uploadWorkspaceAttachment).toHaveBeenCalledWith("token", "ai_referent_letter", "letter-1", file, "primary", undefined, 3);
    expect(createAIReferentLetter).not.toHaveBeenCalled();
    expect(actOnAIReferentLetter).not.toHaveBeenCalled();
  });

  it("requires a preliminary reviewer for Bobur and does not wrap dropdowns in labels", async () => {
    vi.mocked(loadAIReferentReviewers).mockResolvedValue({ revision: 1, updatedAt: "2026-09-25", runtimes: [], reviewers: [
      { key: "bobur", userId: "bobur", username: "bobur", fullName: "Бобур", telegramId: null, enabled: true, canApprove: true, suggestedUsername: "bobur", label: "Бобур", accountActive: true },
      { key: "askar", userId: "askar", username: "askar", fullName: "Аскар", telegramId: null, enabled: true, canApprove: true, suggestedUsername: "askar", label: "Аскар", accountActive: true },
    ] });
    render(<FluentProvider theme={workspaceTheme}><AIReferentView token="token" people={[]} canCreate /></FluentProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Исходящие" }));
    await waitFor(() => expect(loadAIReferentReviewers).toHaveBeenCalled());
    await openComposer();
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
    const registerBar = screen.getByRole("tablist", { name: "Реестры корреспонденции" }).parentElement;
    const newLetter = screen.getByRole("button", { name: /Новое письмо/ });
    const signOnly = screen.getByRole("button", { name: "На подпись" });
    expect(newLetter).toBeEnabled();
    expect(newLetter.closest(".ai-referent-register-actions")?.parentElement).toBe(registerBar);
    expect(signOnly.closest(".ai-referent-register-actions")?.parentElement).toBe(registerBar);
    expect(document.querySelector(".ai-referent-header-actions")).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "На подпись" }));
    const dialog = await screen.findByRole("dialog", { name: "Подписать без отправки" });
    expect(within(dialog).getByText(/каждый лист отдельным подписанным PDF/)).toBeInTheDocument();
    expect(within(dialog).queryByText("Канал отправки")).toBeNull();
    expect(within(dialog).queryByText("Второй согласующий (необязательно)")).toBeNull();
    expect(within(dialog).queryByText("Кому отправить")).toBeNull();
  });
});
