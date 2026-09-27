import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { EmployeeRecognitionProfile } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmployeeProfileDialog } from "./EmployeeProfileDialog";
import {
  issueEmployeeReward,
  loadEmployeeRecognitionProfile,
} from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({
  issueEmployeeReward: vi.fn(),
  loadEmployeeRecognitionProfile: vi.fn(),
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

function renderProfile(value: EmployeeRecognitionProfile = profile) {
  vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(value);
  render(<FluentProvider theme={workspaceTheme}>
    <EmployeeProfileDialog token="token" userId="baxtiyor" open onOpenChange={vi.fn()} />
  </FluentProvider>);
}

describe("EmployeeProfileDialog", () => {
  it("shows public work data and explains achievement rules", async () => {
    renderProfile();

    expect(await screen.findByRole("heading", { name: "Бахтиёр Самугов" })).toBeVisible();
    expect(screen.getByText("Проектный офис")).toBeVisible();
    expect(screen.getByText("2 г. 7 мес. 23 дн.")).toBeVisible();
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
    fireEvent.click(screen.getByRole("button", { name: "Вернуться к профилю" }));
    expect(screen.getByRole("dialog", { name: "Публичный профиль сотрудника" })).toBeVisible();
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
    expect(await screen.findByRole("button", { name: /Командная работа: 1 наград/ })).toBeVisible();
  });

  it("groups repeated rewards and opens the full issuer history", async () => {
    renderProfile({ ...profile, rewards: [
      { id: "reward-2", iconKey: "teamwork", title: "Командная работа", description: "За объединение коллег ради общего результата.", contextNote: "Проект Ташкент", recipientUserId: "baxtiyor", issuerUserId: "temur", issuerName: "Темур Алмазов", createdAt: "2026-09-25T10:00:00Z" },
      { id: "reward-1", iconKey: "teamwork", title: "Старая подпись", description: "Историческое описание награды.", recipientUserId: "baxtiyor", issuerUserId: "malika", issuerName: "Малика Нурова", createdAt: "2026-09-24T10:00:00Z" },
    ] });
    const card = await screen.findByRole("button", { name: /Командная работа: 2 наград/ });
    expect(screen.getByText("×2")).toBeVisible();
    fireEvent.click(card);
    const history = screen.getByRole("dialog", { name: "История награды" });
    expect(history).toHaveTextContent("Темур Алмазов");
    expect(history).toHaveTextContent("Малика Нурова");
    expect(history).toHaveTextContent("Проект Ташкент");
    expect(history).toHaveTextContent("Историческое описание награды.");
    fireEvent.click(screen.getByRole("button", { name: "Вернуться к профилю" }));
    expect(screen.getByRole("button", { name: /Командная работа: 2 наград/ })).toBeVisible();
  });
});
