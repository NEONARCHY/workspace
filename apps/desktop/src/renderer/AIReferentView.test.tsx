import { render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIReferentView } from "./AIReferentView";
import { workspaceTheme } from "./workspace-theme";
import { loadAIReferentRegistry } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  actOnAIReferentLetter: vi.fn(),
  createAIReferentLetter: vi.fn(),
  downloadWorkspaceAttachment: vi.fn(),
  loadAIReferentRegistry: vi.fn(),
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

describe("AIReferentView", () => {
  beforeEach(() => {
    vi.mocked(loadAIReferentRegistry).mockResolvedValue(registry);
  });

  it("shows the shared outgoing register and its review queue", async () => {
    render(
      <FluentProvider theme={workspaceTheme}>
        <AIReferentView token="token" people={[]} canCreate />
      </FluentProvider>,
    );

    expect(screen.getByRole("heading", { name: "AI Referent" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ответ партнёру")).toBeInTheDocument());
    expect(screen.getByText("Организация-получатель")).toBeInTheDocument();
    expect(screen.getAllByText("На согласовании")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: /Новое письмо/ })).toBeEnabled();
  });
});
