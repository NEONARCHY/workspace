import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { EmployeeRecognitionProfile } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmployeeProfileDialog } from "./EmployeeProfileDialog";
import {
  issueEmployeeReward,
  loadEmployeeRecognitionProfile,
  loadWorkspaceEfficiency,
} from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({
  issueEmployeeReward: vi.fn(),
  loadEmployeeRecognitionProfile: vi.fn(),
  loadWorkspaceEfficiency: vi.fn(),
  loadProfileAvatar: vi.fn(),
}));

const profile: EmployeeRecognitionProfile = {
  person: {
    id: "baxtiyor",
    name: "Бахтиёр Самугов",
    initials: "БС",
    role: "employee",
    color: "#0091A8",
    jobTitle: "Руководитель проекта",
  },
  departmentName: "Проектный офис",
  employmentDate: "2024-02-01",
  serviceYears: 2,
  serviceMonths: 7,
  serviceDays: 23,
  activeTaskCount: 4,
  activeTaskCountVisible: true,
  achievements: [
    {
      code: "tasks_1",
      title: "Завершённые задачи · 1",
      description: "Принятые рабочие задачи",
      category: "tasks",
      tier: "bronze",
      iconKey: "check",
      progress: 4,
      target: 1,
      unlocked: true,
    },
    {
      code: "tasks_10",
      title: "Завершённые задачи · 10",
      description: "Принятые рабочие задачи",
      category: "tasks",
      tier: "silver",
      iconKey: "check",
      progress: 4,
      target: 10,
      unlocked: false,
    },
    {
      code: "projects_100",
      title: "Проекты · 100",
      description: "Успешно завершённые проекты под руководством сотрудника",
      category: "projects",
      tier: "cosmic",
      iconKey: "layers",
      progress: 24,
      target: 100,
      unlocked: false,
    },
  ],
  rewards: [],
  rewardCatalog: [
    { iconKey: "appreciation", title: "Благодарность", description: "За помощь и человеческую поддержку." },
    { iconKey: "leadership", title: "Лидерство", description: "За ясное направление и ответственность." },
    { iconKey: "rescue", title: "Спасение срока", description: "За решающий вклад в критический момент." },
    { iconKey: "mentorship", title: "Наставничество", description: "За развитие и поддержку коллег." },
    { iconKey: "innovation", title: "Новаторство", description: "За идею, улучшившую рабочий процесс." },
    { iconKey: "reliability", title: "Надёжность", description: "За устойчивый результат, на который можно опереться." },
    { iconKey: "teamwork", title: "Командная работа", description: "За объединение коллег ради общего результата." },
    { iconKey: "initiative", title: "Инициатива", description: "За полезное дело, начатое без отдельного поручения." },
    { iconKey: "mastery", title: "Мастерство", description: "За высокий профессионализм и качество работы." },
  ],
  canIssueReward: true,
  canManageSettings: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderProfile(value: EmployeeRecognitionProfile = profile, options: {
  currentUserId?: string;
  onOpenChat?: (userId: string) => Promise<void>;
} = {}) {
  vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(value);
  vi.mocked(loadWorkspaceEfficiency).mockResolvedValue({
    period: "2026-09", timezone: "Asia/Tashkent", methodologyVersion: "1", trackingStartedAt: "2026-01-01", currentUserId: "manager",
    employees: [{ userId: "baxtiyor", name: "Бахтиёр Самугов", jobTitle: "Руководитель проекта", period: "2026-09", timezone: "Asia/Tashkent", percentage: 80, onTimeCount: 4, eligibleCount: 5, overdueCount: 1, awaitingReviewCount: 0, noDueDateCount: 0, returnedForRevisionCount: 0, excludedCount: 0, sampleSize: 5, methodologyVersion: "1", trackingStartedAt: "2026-01-01", historyCompleteness: "complete", smallSample: false, history: [] }],
  });
  const onOpenPersonProfile = vi.fn();
  render(<FluentProvider theme={workspaceTheme}>
    <EmployeeProfileDialog token="token" userId="baxtiyor" currentUserId={options.currentUserId} open onOpenChange={vi.fn()} onOpenPersonProfile={onOpenPersonProfile} onOpenChat={options.onOpenChat} people={[value.person, { id: "temur", name: "Темур Алмазов", initials: "ТА", role: "employee", color: "#0091a8" }]} />
  </FluentProvider>);
  return onOpenPersonProfile;
}

describe("EmployeeProfileDialog", () => {
  it("measures pinned header clearance, adapts to unpinned layout and cleans up observers", async () => {
    const observers: { callback: ResizeObserverCallback; observer: ResizeObserver; targets: Set<Element> }[] = [];
    class HeaderResizeObserver extends ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        const targets = new Set<Element>();
        this.observe = vi.fn((target: Element) => { targets.add(target); });
        this.disconnect = vi.fn();
        observers.push({ callback, observer: this, targets });
      }
    }
    vi.stubGlobal("ResizeObserver", HeaderResizeObserver);
    try {
      renderProfile();
      await screen.findByRole("heading", { name: profile.person.name });
      const header = document.querySelector<HTMLElement>(".employee-profile-sticky")!;
      const content = header.closest<HTMLElement>(".fui-DialogContent")!;
      const measured = observers.find((entry) => entry.targets.has(header))!;
      expect(measured.targets.has(content)).toBe(true);
      header.style.position = "sticky";
      Object.defineProperty(header, "offsetHeight", { value: 244, configurable: true });
      act(() => measured.callback([], measured.observer));
      expect(content.style.getPropertyValue("--employee-profile-header-inset")).toBe("260px");
      Object.defineProperty(content, "clientHeight", { value: 300, configurable: true });
      act(() => measured.callback([], measured.observer));
      expect(header).toHaveClass("is-unpinned");
      expect(content.style.getPropertyValue("--employee-profile-header-inset")).toBe("16px");
      Object.defineProperty(content, "clientHeight", { value: 620, configurable: true });
      act(() => measured.callback([], measured.observer));
      expect(header).not.toHaveClass("is-unpinned");
      expect(content.style.getPropertyValue("--employee-profile-header-inset")).toBe("260px");
      header.style.position = "static";
      act(() => measured.callback([], measured.observer));
      expect(content.style.getPropertyValue("--employee-profile-header-inset")).toBe("16px");
      cleanup();
      expect(measured.observer.disconnect).toHaveBeenCalled();
      expect(content.style.getPropertyValue("--employee-profile-header-inset")).toBe("");
      expect(header).not.toHaveClass("is-unpinned");
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("preserves long identity copy, truthful recognition counts and each navigation target", async () => {
    const jobTitle = "Руководитель направления координации региональных подразделений и международного сотрудничества";
    renderProfile({ ...profile, person: { ...profile.person, jobTitle } });
    expect(await screen.findByRole("heading", { name: profile.person.name })).toBeVisible();
    const hero = document.querySelector(".employee-profile-hero");
    expect(hero).toHaveTextContent(jobTitle);
    expect(hero).toHaveTextContent("Проектный офис");
    expect(hero?.querySelector(".employee-profile-hero-stat strong")).toHaveTextContent("0");
    expect(hero?.querySelector(".employee-profile-hero-stat small")).toHaveTextContent("1 достижение");
    const navigation = screen.getByRole("navigation", { name: "Навигация по профилю" });
    for (const label of ["Награды", "Достижения", "Обзор"]) {
      const button = within(navigation).getByRole("button", { name: label });
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(within(navigation).getAllByRole("button").filter((item) => item.getAttribute("aria-pressed") === "true")).toHaveLength(1);
      expect(document.getElementById(button.getAttribute("aria-controls") ?? "")).toBeInTheDocument();
    }
    expect(issueEmployeeReward).not.toHaveBeenCalled();
  });

  it("opens a direct chat from another employee's profile, but not from one's own", async () => {
    const onOpenChat = vi.fn().mockResolvedValue(undefined);
    renderProfile(profile, { currentUserId: "temur", onOpenChat });
    fireEvent.click(await screen.findByRole("button", { name: "Написать сообщение" }));
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledWith("baxtiyor"));

    cleanup();
    renderProfile(profile, { currentUserId: "baxtiyor", onOpenChat });
    expect(await screen.findByRole("heading", { name: "Бахтиёр Самугов" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Написать сообщение" })).not.toBeInTheDocument();
  });

  it("shows public work data and explains achievement rules", async () => {
    renderProfile();

    expect(await screen.findByRole("heading", { name: "Бахтиёр Самугов" })).toBeVisible();
    expect(screen.getByText("Проектный офис")).toBeVisible();
    expect(screen.getByText("2 г. 7 мес. 23 дн.")).toBeVisible();
    expect(await screen.findByRole("meter", { name: "Эффективность выполнения задач в срок" })).toHaveAttribute("aria-valuenow", "80");
    fireEvent.click(screen.getByRole("button", { name: "Достижения" }));
    const unlockedCard = screen.getByText("Завершённые задачи · 1").closest("article");
    expect(unlockedCard).toHaveClass("is-unlocked");
    expect(screen.getByText("Завершённые задачи · 10")).toBeVisible();
    const cosmicCard = screen.getByText("Проекты · 100").closest("article");
    expect(cosmicCard).not.toHaveClass("is-unlocked");
    expect(cosmicCard).toHaveClass("recognition-rarity-cosmic");
    expect(cosmicCard?.querySelector(".recognition-card-foil")).toBeInTheDocument();
    expect(cosmicCard?.querySelector(".recognition-card-glare")).toBeInTheDocument();
    const cosmicArtwork = cosmicCard?.querySelector<HTMLImageElement>(".recognition-badge-artwork");
    expect(cosmicArtwork).toHaveAttribute("data-recognition-icon", "layers");
    expect(cosmicArtwork?.src).toContain("cube");
    expect(cosmicCard?.querySelector("svg.recognition-badge-artwork")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Как это работает" }));
    expect(screen.getByRole("dialog", { name: "Как работают награды и достижения" })).toHaveTextContent(
      "Личные чаты один на один",
    );
    expect(screen.getByRole("dialog", { name: "Как работают награды и достижения" })).toHaveTextContent("100");
    expect(screen.getByRole("dialog", { name: "Публичный профиль сотрудника", hidden: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Вернуться к профилю" }));
    expect(screen.getByRole("dialog", { name: "Публичный профиль сотрудника" })).toBeVisible();
  });

  it("shows an efficiency load failure and retries without pretending the employee has no data", async () => {
    vi.mocked(loadWorkspaceEfficiency).mockRejectedValueOnce(new Error("Network unavailable"));
    renderProfile();

    expect(await screen.findByText("Не удалось загрузить показатель")).toBeVisible();
    expect(screen.getByText("Недоступно")).toBeVisible();
    expect(screen.queryByRole("meter", { name: "Эффективность выполнения задач в срок" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку эффективности" }));
    expect(await screen.findByRole("meter", { name: "Эффективность выполнения задач в срок" })).toHaveAttribute("aria-valuenow", "80");
    expect(loadWorkspaceEfficiency).toHaveBeenCalledTimes(2);
  });

  it("issues a ready-made reward with optional context instead of editable title and description", async () => {
    renderProfile();
    vi.mocked(issueEmployeeReward).mockResolvedValue({
      id: "reward-1",
      iconKey: "teamwork",
      title: "Командная работа",
      description: "За объединение коллег ради общего результата.",
      contextNote: "После запуска проекта",
      recipientUserId: "baxtiyor",
      issuerUserId: "manager",
      issuerName: "Малика Нурова",
      createdAt: "2026-09-24T10:00:00Z",
    });

    await screen.findByRole("heading", { name: "Бахтиёр Самугов" });
    fireEvent.click(screen.getByRole("button", { name: "Награды" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Выдать награду" }).at(-1)!);
    const issueDialog = screen.getByRole("dialog", { name: "Выдать награду" });
    expect(screen.getByRole("dialog", { name: "Публичный профиль сотрудника", hidden: true })).not.toContainElement(issueDialog);
    expect(screen.getByRole("group", { name: "Вид награды" }).querySelectorAll("button")).toHaveLength(9);
    expect(screen.queryByLabelText("Название награды")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("За что выдаётся")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Командная работа/ }));
    fireEvent.change(screen.getByPlaceholderText("Что хочется отметить именно сейчас?"), { target: { value: "После запуска проекта" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Выдать награду" }).at(-1)!);

    await waitFor(() => expect(issueEmployeeReward).toHaveBeenCalledWith(
      "token",
      "baxtiyor",
      {
        iconKey: "teamwork",
        contextNote: "После запуска проекта",
      },
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Выдать награду", hidden: true })).not.toBeInTheDocument(), { timeout: 10_000 });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Публичный профиль сотрудника" })).toBeVisible(), { timeout: 10_000 });
    expect(await screen.findByRole("button", { name: /Командная работа: 1 награда/ })).toBeVisible();
  });

  it("groups repeated rewards and opens the full issuer history", async () => {
    const onOpenPersonProfile = renderProfile({ ...profile, rewards: [
      { id: "reward-2", iconKey: "teamwork", title: "Командная работа", description: "За объединение коллег ради общего результата.", contextNote: "Проект Ташкент", recipientUserId: "baxtiyor", issuerUserId: "temur", issuerName: "Темур Алмазов", createdAt: "2026-09-25T10:00:00Z" },
      { id: "reward-1", iconKey: "teamwork", title: "Старая подпись", description: "Историческое описание награды.", recipientUserId: "baxtiyor", issuerUserId: "malika", issuerName: "Малика Нурова", createdAt: "2026-09-24T10:00:00Z" },
    ] });
    const card = await screen.findByRole("button", { name: /Командная работа: 2 награды/ });
    expect(screen.getByText("×2")).toBeVisible();
    fireEvent.click(card);
    const history = screen.getByRole("dialog", { name: "История награды" });
    expect(screen.getByRole("dialog", { name: "Публичный профиль сотрудника", hidden: true })).toBeInTheDocument();
    expect(history).toHaveTextContent("Темур Алмазов");
    expect(history).toHaveTextContent("Малика Нурова");
    expect(history).toHaveTextContent("Проект Ташкент");
    expect(history).toHaveTextContent("Историческое описание награды.");
    fireEvent.click(within(history).getByRole("button", { name: "Темур Алмазов" }));
    expect(onOpenPersonProfile).toHaveBeenCalledWith("temur");
    expect(screen.getByRole("dialog", { name: "Публичный профиль сотрудника", hidden: true })).toBeInTheDocument();
  });

  it("returns to the same profile after closing reward history", async () => {
    renderProfile({ ...profile, rewards: [
      { id: "reward-1", iconKey: "teamwork", title: "Командная работа", description: "За объединение коллег ради общего результата.", recipientUserId: "baxtiyor", issuerUserId: "temur", issuerName: "Темур Алмазов", createdAt: "2026-09-25T10:00:00Z" },
    ] });
    const card = await screen.findByRole("button", { name: /Командная работа: 1 награда/ });
    fireEvent.click(card);
    expect(screen.getByRole("dialog", { name: "История награды" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Вернуться к профилю" }));
    expect(screen.getByRole("button", { name: /Командная работа: 1 награда/ })).toBeVisible();
  });
});
