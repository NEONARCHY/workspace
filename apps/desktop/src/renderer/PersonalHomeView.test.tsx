import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIReferentIncomingLetter, EdoIncomingPage, NavigationKey } from "@yuksalish/contracts";
import { PersonalHomeView } from "./PersonalHomeView";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";
import { workspaceTheme } from "./workspace-theme";
import { homeEfficiency, homeFixture, homeRecognition } from "./test-fixtures/personal-home-fixture";
import { ApiHttpError, loadPersonalEfficiency, loadEmployeeRecognitionProfile, loadPersonalReactions, loadAIReferentIncomingRegistry, loadEdoIncomingLetters, loadProjectHub } from "./workspace-api";
vi.mock("./workspace-api", () => ({
  ApiHttpError: class extends Error {
    constructor(readonly status: number, message: string) { super(message); }
  },
  loadPersonalEfficiency: vi.fn(), loadEmployeeRecognitionProfile: vi.fn(), loadPersonalReactions: vi.fn(),
  loadAIReferentIncomingRegistry: vi.fn(), loadEdoIncomingLetters: vi.fn(), loadProjectHub: vi.fn(),
}));
const onOpen = vi.fn(), onProfile = vi.fn(), onNotification = vi.fn();
const all = () => true;
const onlyEdo = (key: string) => key === "incoming_letters";
function edoPage(): EdoIncomingPage {
  return {
    visibility: "assigned", deadline_timezone_verified: false,
    meta: { page: 1, limit: 20, total: 1 },
    data: [{
      id: 123, version: 1, status: 1, in_num: "123/26", in_date: "2026-10-12",
      out_num: null, out_date: null, organization: "Партнёр ЭДО", region: null,
      description: "Личное письмо ЭДО", deadline: "2026-10-01", deadline2: null,
      type: null, comment: null, result: null, result_time: null,
      legacy_dates_timezone: "", assignments: [], attachments: [], overdue: null,
    }],
  };
}
beforeEach(() => {
  vi.mocked(loadPersonalEfficiency).mockResolvedValue(homeEfficiency());
  vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(homeRecognition());
  vi.mocked(loadPersonalReactions).mockResolvedValue({ totalCount: 7, reactions: [{ emoji: "👍", count: 7 }] });
  vi.mocked(loadAIReferentIncomingRegistry).mockRejectedValue(new Error("Реестр временно недоступен"));
  vi.mocked(loadEdoIncomingLetters).mockRejectedValue(new Error("ЭДО временно недоступно"));
  vi.mocked(loadProjectHub).mockResolvedValue({ projects: [], workstreams: [], items: [], requests: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
function view(userId = "aziza", canView: (key: NavigationKey) => boolean = all, token = userId) {
  return <FluentProvider theme={workspaceTheme}><EmployeeProfileProvider onOpenProfile={onProfile}>
    <PersonalHomeView token={token} key={userId} workspace={homeFixture(userId)} canView={canView}
      onOpen={onOpen} onOpenNotification={onNotification} onRefresh={async () => undefined} />
  </EmployeeProfileProvider></FluentProvider>;
}
describe("Personal Home", () => {
  it("releases the page after three seconds even when one integration hangs", async () => {
    vi.useFakeTimers();
    vi.mocked(loadEdoIncomingLetters).mockImplementationOnce(() => new Promise(() => {}));
    render(view("aziza", onlyEdo));
    expect(screen.getByRole("status")).toHaveTextContent("Собираем ваше рабочее пространство");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByText("Собираем ваше рабочее пространство…")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Мои письма" })).getByRole("status")).toHaveAccessibleName("Загрузка данных");
  });
  it("shows personally scoped compact EDO rows without assignments and opens the exact letter", async () => {
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue(edoPage());
    render(view("aziza", onlyEdo));
    const panel = within(await screen.findByRole("region", { name: "Мои письма" }));
    fireEvent.click(await panel.findByRole("button", { name: /Личное письмо ЭДО/ }));
    expect(loadEdoIncomingLetters).toHaveBeenCalledWith("aziza", { personal: true });
    expect(onOpen).toHaveBeenCalledWith({ section: "incoming_letters", entityId: "123" });
    expect(panel.getByText(/ЭДО · №123\/26 · Партнёр ЭДО · В работе/)).toBeInTheDocument();
    expect(panel.queryByText(/в разработке/i)).not.toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Открыть входящие письма" }));
    expect(onOpen).toHaveBeenLastCalledWith({ section: "incoming_letters" });
  });
  it.each(["all", "departments", undefined] as const)("does not expose an unconfirmed personal scope: %s", async visibility => {
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue({ ...edoPage(), visibility });
    render(view("aziza", onlyEdo));
    const panel = within(await screen.findByRole("region", { name: "Мои письма" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("Не удалось подтвердить личную область писем");
    expect(panel.queryByText("Личное письмо ЭДО")).not.toBeInTheDocument();
  });
  it("keeps loading distinct from a successfully empty personal register", async () => {
    let finish: ((value: EdoIncomingPage) => void) | undefined;
    vi.mocked(loadEdoIncomingLetters).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(view("aziza", onlyEdo));
    expect(screen.getByRole("status")).toHaveTextContent("Собираем ваше рабочее пространство");
    expect(screen.queryByRole("region", { name: "Мои письма" })).not.toBeInTheDocument();
    await waitFor(() => expect(loadEdoIncomingLetters).toHaveBeenCalled());
    await act(async () => finish?.({ ...edoPage(), data: [], meta: { page: 1, limit: 20, total: 0 } }));
    const panel = within(await screen.findByRole("region", { name: "Мои письма" }));
    expect(panel.getByText("В последних доступных письмах нет назначенных вам.")).toBeInTheDocument();
    expect(panel.queryByRole("status", { name: "Загрузка данных" })).not.toBeInTheDocument();
  });
  it("allows retry after a 503 without claiming the integration is in development", async () => {
    vi.mocked(loadEdoIncomingLetters).mockRejectedValueOnce(new ApiHttpError(503, "Интеграция писем не настроена."))
      .mockResolvedValue(edoPage());
    render(view("aziza", onlyEdo));
    const panel = within(await screen.findByRole("region", { name: "Мои письма" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("Интеграция писем не настроена.");
    fireEvent.click(panel.getByRole("button", { name: "Повторить" }));
    expect(await panel.findByRole("button", { name: /Личное письмо ЭДО/ })).toBeInTheDocument();
    expect(panel.queryByRole("alert")).not.toBeInTheDocument();
    expect(panel.queryByText(/в разработке/i)).not.toBeInTheDocument();
  });
  it("does not declare overdue until EDO confirms the legacy timezone", async () => {
    const page = edoPage();
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue({ ...page, data: [{ ...page.data[0]!, overdue: true }] });
    render(view("aziza", onlyEdo));
    const panel = within(await screen.findByRole("region", { name: "Мои письма" }));
    const row = await panel.findByRole("button", { name: /Личное письмо ЭДО/ });
    expect(row).toHaveAttribute("data-tone", "brand");
    expect(row).not.toHaveTextContent("Просрочено");
  });
  it("shows verified overdue and limits the preview without changing the server total", async () => {
    const page = edoPage();
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue({ ...page, deadline_timezone_verified: true,
      data: Array.from({ length: 4 }, (_, index) => ({ ...page.data[0]!, id: index + 1,
        description: `Письмо ЭДО ${index + 1}`, overdue: true })),
      meta: { page: 1, limit: 20, total: 10 },
    });
    render(view("aziza", onlyEdo));
    const panel = within(await screen.findByRole("region", { name: "Мои письма" }));
    const row = await panel.findByRole("button", { name: /Письмо ЭДО 1/ });
    expect(row).toHaveAttribute("data-tone", "danger");
    expect(row).toHaveTextContent("Просрочено");
    expect(panel.queryByText("Письмо ЭДО 4")).not.toBeInTheDocument();
    expect(panel.getByText(/Писем, назначенных вам в ЭДО: 10/)).toBeInTheDocument();
  });
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
    expect(screen.getByRole("heading", { name: "Добрый день, Азиза" })).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Добрый день, Дилшод" })).toBeInTheDocument();
  });
  it("keeps loaded cards visible during credential renewal and shows a retry without erasing data", async () => {
    const rendered = render(view("aziza", all, "first-token"));
    await screen.findAllByText("80%");
    vi.mocked(loadPersonalEfficiency).mockRejectedValue(new Error("Временная ошибка обновления"));
    rendered.rerender(view("aziza", all, "renewed-token"));
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    await screen.findByText("Временная ошибка обновления");
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    expect(loadPersonalEfficiency).toHaveBeenLastCalledWith("renewed-token", expect.any(String));
  });
  it("keeps the existing layout during polling until the employee accepts the new priorities", async () => {
    const base = homeFixture(), calm = { ...base, tasks: [], notifications: [], chats: [], calendarEvents: [] };
    const props = { token: "aziza", workspace: calm, canView: all, onOpen, onOpenNotification: onNotification, onRefresh: async () => undefined };
    const rendered = render(<PersonalHomeView {...props} />);
    await screen.findAllByText("80%");
    const first = () => document.querySelector(".home-grid > div section")?.getAttribute("data-home-panel");
    expect(first()).toBe("efficiency");
    rendered.rerender(<PersonalHomeView {...props} workspace={base} />);
    expect(first()).toBe("efficiency");
    fireEvent.click(screen.getByRole("button", { name: "Обновить фокус дня" }));
    expect(first()).toBe("attention");
    await screen.findAllByText("80%");
  });
});
