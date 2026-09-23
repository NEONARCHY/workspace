import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIReferentView } from "./AIReferentView";
import { workspaceTheme } from "./workspace-theme";
import { actOnAIReferentLetter, loadAIReferentLetter, loadAIReferentPacket, loadAIReferentIncomingRegistry, loadAIReferentRegistry, loadAIReferentReviewers } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  actOnAIReferentLetter: vi.fn(),
  createAIReferentLetter: vi.fn(),
  downloadAIReferentJournal: vi.fn(),
  downloadWorkspaceAttachment: vi.fn(),
  loadAIReferentRegistry: vi.fn(),
  loadAIReferentLetter: vi.fn(),
  loadAIReferentPacket: vi.fn(),
  downloadAIReferentPacket: vi.fn(),
  loadAIReferentReviewers: vi.fn(),
  loadAIReferentIncomingRegistry: vi.fn(),
  updateAIReferentLetter: vi.fn(),
  uploadWorkspaceAttachment: vi.fn(),
}));

const registry = {
  totalCount: 1,
  pendingReviewCount: 1,
  readyCount: 0,
  sentCount: 0,
  letters: [{
    id: "letter-1",
    subject: "Ответ партнёру",
    recipientOrganization: "Организация-получатель",
    recipientAddress: "Канцелярия",
    route: "exat" as const,
    note: "",
    status: "pending_review" as const,
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
    await waitFor(() => expect(actOnAIReferentLetter).toHaveBeenCalledWith("token", expect.objectContaining({ id: "letter-1", revision: 2 }), "return_for_revision", "Уточните адрес", expect.any(String)));
    expect(await screen.findAllByText("Письмо уже изменилось")).not.toHaveLength(0);
    expect(comment).toHaveValue("Уточните адрес");
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
    expect(screen.getByText("Организация-отправитель")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excel-журнал/ })).toBeEnabled();

    fireEvent.click(screen.getByRole("tab", { name: "Исходящие" }));
    await waitFor(() => expect(screen.getByText("Ответ партнёру")).toBeInTheDocument());
    expect(screen.getByText("Организация-получатель")).toBeInTheDocument();
    expect(screen.getAllByText("На согласовании")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: /Новое письмо/ })).toBeEnabled();
  });
});
