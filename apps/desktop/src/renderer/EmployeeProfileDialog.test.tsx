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
  canIssueReward: true,
  canManageSettings: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderProfile() {
  vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(profile);
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
    expect(screen.getByText("Завершённые задачи · 1")).toBeVisible();
    expect(screen.getByText("Завершённые задачи · 10")).toBeVisible();
    const cosmicCard = screen.getByText("Проекты · 100").closest("article");
    expect(cosmicCard).toHaveClass("recognition-rarity-cosmic");
    expect(cosmicCard?.querySelector(".recognition-card-foil")).toBeInTheDocument();
    expect(cosmicCard?.querySelector(".recognition-card-glare")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Как это работает" }));
    expect(screen.getByRole("dialog", { name: "Как работают достижения" })).toHaveTextContent(
      "Личные чаты один на один",
    );
  });

  it("lets an authorized leader issue a free-form reward", async () => {
    renderProfile();
    vi.mocked(issueEmployeeReward).mockResolvedValue({
      id: "reward-1",
      iconKey: "innovation",
      title: "Новое решение",
      description: "Упростил сложный рабочий процесс для всей команды.",
      recipientUserId: "baxtiyor",
      issuerUserId: "manager",
      issuerName: "Малика Нурова",
      createdAt: "2026-09-24T10:00:00Z",
    });

    await screen.findByRole("heading", { name: "Бахтиёр Самугов" });
    fireEvent.click(screen.getByRole("button", { name: "Награды" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Выдать награду" }).at(-1)!);
    fireEvent.click(screen.getByRole("radio", { name: /Новаторство/ }));
    fireEvent.change(screen.getByPlaceholderText("Например, Сильная командная опора"), {
      target: { value: "Новое решение" },
    });
    fireEvent.change(screen.getByPlaceholderText("Коротко опишите конкретный вклад сотрудника"), {
      target: { value: "Упростил сложный рабочий процесс для всей команды." },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Выдать награду" }).at(-1)!);

    await waitFor(() => expect(issueEmployeeReward).toHaveBeenCalledWith(
      "token",
      "baxtiyor",
      {
        iconKey: "innovation",
        title: "Новое решение",
        description: "Упростил сложный рабочий процесс для всей команды.",
      },
    ));
    expect(await screen.findByText("Новое решение")).toBeVisible();
  });
});
