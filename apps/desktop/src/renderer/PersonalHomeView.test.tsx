import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIReferentIncomingLetter } from "@yuksalish/contracts";
import { PersonalHomeView } from "./PersonalHomeView";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";
import { workspaceTheme } from "./workspace-theme";
import { homeEfficiency, homeFixture, homeRecognition } from "./test-fixtures/personal-home-fixture";
import { loadPersonalEfficiency, loadEmployeeRecognitionProfile, loadPersonalReactions, loadAIReferentIncomingRegistry, loadEdoIncomingLetters, loadProjectHub } from "./workspace-api";
vi.mock("./workspace-api", () => ({
  ApiHttpError: class extends Error { status = 503; },
  loadPersonalEfficiency: vi.fn(), loadEmployeeRecognitionProfile: vi.fn(), loadPersonalReactions: vi.fn(),
  loadAIReferentIncomingRegistry: vi.fn(), loadEdoIncomingLetters: vi.fn(), loadProjectHub: vi.fn(),
}));
const onOpen = vi.fn(), onProfile = vi.fn(), onNotification = vi.fn();
const all = () => true;
beforeEach(() => {
  vi.mocked(loadPersonalEfficiency).mockResolvedValue(homeEfficiency());
  vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(homeRecognition());
  vi.mocked(loadPersonalReactions).mockResolvedValue({ totalCount: 7, reactions: [{ emoji: "👍", count: 7 }] });
  vi.mocked(loadAIReferentIncomingRegistry).mockRejectedValue(new Error("Реестр временно недоступен"));
  vi.mocked(loadEdoIncomingLetters).mockRejectedValue(new Error("ЭДО временно недоступно"));
  vi.mocked(loadProjectHub).mockResolvedValue({ projects: [], workstreams: [], items: [], requests: [] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function view(userId = "aziza", canView = all, token = userId) {
  return <FluentProvider theme={workspaceTheme}><EmployeeProfileProvider onOpenProfile={onProfile}>
    <PersonalHomeView token={token} key={userId} workspace={homeFixture(userId)} canView={canView}
      onOpen={onOpen} onOpenNotification={onNotification} onRefresh={async () => undefined} />
  </EmployeeProfileProvider></FluentProvider>;
}
describe("Personal Home", () => {
  it("previews only explicitly assigned letters and opens the incoming register, not an outgoing request", async () => {
    const letter: AIReferentIncomingLetter = {
      id: "assigned-incoming", agentId: "agent", externalId: "external", sequenceNumber: "1",
      platformIncomingNumber: "001", senderLetterNumber: "002", senderOrganization: "Партнёр",
      senderPerson: "Контакт", subject: "Персональное входящее", responsibleExternalId: "external-user",
      responsibleDisplayName: "Азиза Каримова", responsibleUserId: "aziza", urgency: "normal",
      hasAttachments: false, attachmentsCount: 0, mainDocumentFilename: "", platformRecordId: "record",
      status: "completed", fallbackUsed: false, errorMessage: "", source: "webmail", revision: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    vi.mocked(loadAIReferentIncomingRegistry).mockResolvedValue({ letters: [letter, { ...letter, id: "foreign", responsibleUserId: "dilshod", subject: "Чужое письмо" }], totalCount: 2, filteredCount: 2, registeredCount: 2, attentionCount: 0, withAttachmentsCount: 0, journal: { available: false } });
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: /Персональное входящее/ }));
    expect(onOpen).toHaveBeenCalledWith({ section: "ai_referent", entityId: "assigned-incoming", incomingReferent: true });
    expect(screen.queryByText("Чужое письмо")).not.toBeInTheDocument();
  });
  it("shows real personal cards and opens the corresponding chat, notification, profile and post", async () => {
    render(view());
    expect((await screen.findAllByText("80%")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Мой отдел" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "Мини-мессенджер" })).getAllByRole("button")[1]!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ section: "messenger", entityId: expect.any(String) }));
    fireEvent.click(screen.getByRole("button", { name: /Проверьте итоговый документ/ }));
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ id: "home-notice" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть профиль: Бахтиёр Самугов" }));
    expect(onProfile).toHaveBeenCalledWith("baxtiyor");
    fireEvent.click(screen.getByRole("button", { name: /План недели и материалы встречи/ }));
    expect(onOpen).toHaveBeenCalledWith({ section: "feed", entityId: "home-post" });
  });
  it("does not request or render prohibited source modules", async () => {
    render(view("aziza", () => false));
    await waitFor(() => expect(loadPersonalEfficiency).toHaveBeenCalled());
    expect(loadPersonalReactions).not.toHaveBeenCalled(); expect(loadEdoIncomingLetters).not.toHaveBeenCalled();
    expect(loadAIReferentIncomingRegistry).not.toHaveBeenCalled(); expect(loadProjectHub).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Мини-мессенджер" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "События из ленты" })).not.toBeInTheDocument();
  });
  it("drops previous employee's data and ignores late requests after account switch", async () => {
    let finish: ((value: ReturnType<typeof homeRecognition>) => void) | undefined;
    vi.mocked(loadEmployeeRecognitionProfile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(homeRecognition("dilshod"));
    vi.mocked(loadPersonalEfficiency).mockResolvedValue(homeEfficiency("dilshod"));
    const rendered = render(view());
    await waitFor(() => expect(loadEmployeeRecognitionProfile).toHaveBeenCalled());
    rendered.rerender(view("dilshod"));
    await act(async () => finish?.({ ...homeRecognition(), rewards: [{ ...homeRecognition().rewards[0]!, title: "Секретная награда прежнего аккаунта" }] }));
    expect(screen.queryByText("Секретная награда прежнего аккаунта")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Дилшод Рахимов/ })).toBeInTheDocument();
  });
  it("keeps the existing layout during polling until the employee accepts the new priorities", async () => {
    const base = homeFixture(), calm = { ...base, tasks: [], notifications: [], chats: [], calendarEvents: [] };
    const props = { token: "aziza", workspace: calm, canView: all, onOpen, onOpenNotification: onNotification, onRefresh: async () => undefined };
    const rendered = render(<PersonalHomeView {...props} />);
    const first = () => document.querySelector(".home-grid > div section")?.getAttribute("data-home-panel");
    expect(first()).toBe("efficiency");
    rendered.rerender(<PersonalHomeView {...props} workspace={base} />);
    expect(first()).toBe("efficiency");
    fireEvent.click(screen.getByRole("button", { name: "Обновить фокус дня" }));
    expect(first()).toBe("attention");
    await screen.findAllByText("80%");
  });
});
