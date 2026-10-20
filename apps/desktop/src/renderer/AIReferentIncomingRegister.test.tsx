import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIReferentIncomingRegistry } from "@yuksalish/contracts";
import { AIReferentIncomingRegister } from "./AIReferentIncomingRegister";
import { AIReferentFiles } from "./AIReferentFiles";
import { loadAIReferentIncomingRegistry } from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({ loadAIReferentIncomingRegistry: vi.fn(), downloadAIReferentJournal: vi.fn() }));
vi.mock("./AIReferentFiles", () => ({ AIReferentFiles: vi.fn(({ token, ownerId }: { token: string; ownerId: string }) =>
  <button type="button" data-token={token}>Пакет {ownerId}</button>) }));

const registry: AIReferentIncomingRegistry = {
  totalCount: 500, filteredCount: 500, registeredCount: 400, attentionCount: 100, withAttachmentsCount: 450,
  journal: { available: false }, lastSyncAt: "2026-10-20T08:00:00Z",
  letters: [{
    id: "incoming-1", agentId: "qa", externalId: "42", sequenceNumber: "42", platformIncomingNumber: "QA-42",
    senderLetterNumber: "OUT-42", receivedAt: "2026-10-20T08:00:00Z", senderOrganization: "Тестовый отправитель",
    senderPerson: "Канцелярия", subject: "Исходная тема", responsibleExternalId: "qa", responsibleDisplayName: "Сотрудник",
    urgency: "normal", hasAttachments: true, attachmentsCount: 2, mainDocumentFilename: "Письмо.pdf", platformRecordId: "record-42",
    status: "platform_submitted", fallbackUsed: false, errorMessage: "", source: "exat", revision: 1,
    createdAt: "2026-10-20T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
  }],
};
const setup = (focusLetterId?: string) => render(<FluentProvider theme={workspaceTheme}>
  <AIReferentIncomingRegister token="token" focusLetterId={focusLetterId} />
</FluentProvider>);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadAIReferentIncomingRegistry).mockResolvedValue(registry); });
afterEach(cleanup);

describe("Incoming registry rendering", () => {
  it("keeps loaded rows and file controls out of search/loading renders", async () => {
    setup(); await screen.findByText("Исходная тема");
    vi.mocked(AIReferentFiles).mockClear();
    vi.mocked(loadAIReferentIncomingRegistry).mockReturnValue(new Promise(() => undefined));
    const input = screen.getByRole("textbox", { name: "Поиск входящих писем" });
    for (const value of ["п", "пи", "пис", "письмо"]) fireEvent.change(input, { target: { value } });
    expect(AIReferentFiles).not.toHaveBeenCalled();
    await waitFor(() => expect(loadAIReferentIncomingRegistry).toHaveBeenLastCalledWith("token", { query: "письмо", category: "all", offset: 0 }));
    expect(screen.getByRole("region", { name: "Реестр входящих писем" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Исходная тема")).toBeInTheDocument();
    expect(AIReferentFiles).not.toHaveBeenCalled();
  });

  it("renders a new server snapshot and retains the focused incoming row", async () => {
    setup("incoming-1"); await screen.findByText("Исходная тема");
    expect(screen.getByRole("row", { name: "Выбранное входящее письмо" })).toHaveClass("is-focused");
    vi.mocked(loadAIReferentIncomingRegistry).mockResolvedValue({ ...registry, letters: [{ ...registry.letters[0]!, subject: "Обновлённая тема" }] });
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await screen.findByText("Обновлённая тема");
    expect(screen.queryByText("Исходная тема")).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Выбранное входящее письмо" })).toHaveClass("is-focused");
    expect(screen.getByRole("button", { name: "Пакет incoming-1" })).toHaveAttribute("data-token", "token");
  });

  it("updates summary metadata without rebuilding identical rows returned as new objects", async () => {
    setup(); await screen.findByText("Исходная тема");
    vi.mocked(AIReferentFiles).mockClear();
    vi.mocked(loadAIReferentIncomingRegistry).mockResolvedValue({ ...registry, totalCount: 600,
      letters: registry.letters.map(letter => ({ ...letter })) });
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await screen.findByRole("button", { name: "600 всего входящих" });
    expect(AIReferentFiles).not.toHaveBeenCalled();
  });
});
