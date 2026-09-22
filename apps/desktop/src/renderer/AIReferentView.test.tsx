import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIReferentView } from "./AIReferentView";
import { workspaceTheme } from "./workspace-theme";
import { loadAIReferentIncomingRegistry, loadAIReferentRegistry, loadAIReferentReviewers } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  actOnAIReferentLetter: vi.fn(),
  createAIReferentLetter: vi.fn(),
  downloadAIReferentJournal: vi.fn(),
  downloadWorkspaceAttachment: vi.fn(),
  loadAIReferentRegistry: vi.fn(),
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
  beforeEach(() => {
    vi.mocked(loadAIReferentRegistry).mockResolvedValue(registry);
    vi.mocked(loadAIReferentIncomingRegistry).mockResolvedValue(incomingRegistry);
    vi.mocked(loadAIReferentReviewers).mockResolvedValue({ revision: 2, updatedAt: "2026-09-22T10:00:00Z",
      reviewers: [], runtimes: [] });
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
