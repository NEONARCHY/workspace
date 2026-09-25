import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";
import type { ProjectHubOverview, ProjectHubRequest } from "@yuksalish/contracts";
import { workspaceTheme } from "./workspace-theme";
import { ProjectHubView } from "./ProjectHubView";
import { people } from "./test-fixtures/demo-data";
import {
  createProjectHubRequest, decideProjectHubRequest, loadProjectHub,
  loadProjectHubRequests, saveProjectHubProject,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadProjectHub: vi.fn(), loadProjectHubRequests: vi.fn(), saveProjectHubProject: vi.fn(),
  saveProjectHubItem: vi.fn(), setProjectHubItemStatus: vi.fn(), publishProjectHubEvent: vi.fn(),
  createProjectHubRequest: vi.fn(), decideProjectHubRequest: vi.fn(),
}));

const project: ProjectHubOverview["projects"][number] = {
  id: "project-1", code: "REG-26", title: "Региональная программа", description: "Развитие сети",
  managerUserId: people[0]!.id, responsibleUserIds: [people[1]!.id],
  approverUserIds: [people[1]!.id, people[2]!.id], startDate: null, endDate: "2030-12-31",
  budget: 1000, currency: "UZS", accessStatus: "open", lifecycleStatus: "active",
  approvedAmount: 300, canEdit: true, createdByUserId: people[0]!.id,
  createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z",
};
const item: ProjectHubOverview["items"][number] = {
  id: "item-1", projectId: project.id, kind: "event", title: "Форум", description: "Встреча",
  startsAt: "2030-10-01T10:00:00Z", dueAt: "2030-10-01T11:00:00Z", budget: 500,
  status: "planned", assigneeUserIds: [people[1]!.id], calendarEventId: null,
  createdByUserId: people[0]!.id, createdAt: "2026-09-25T00:00:00Z",
  updatedAt: "2026-09-25T00:00:00Z", requestCount: 2, approvedRequestCount: 1,
};
const approved: ProjectHubRequest = {
  id: "request-1", projectId: project.id, projectTitle: project.title,
  itemId: item.id, itemTitle: item.title, title: "Аренда зала", purpose: "Площадка",
  amount: 300, currency: "UZS", status: "approved", approverUserIds: project.approverUserIds,
  currentStep: 2, requesterUserId: people[0]!.id, canDecide: false, actions: [],
  createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z",
};
const pending: ProjectHubRequest = { ...approved, id: "request-2", title: "Печать баннеров",
  amount: 100, status: "pending", currentStep: 0, canDecide: true };

function setup(mode: "projects" | "funding" = "projects") {
  render(<FluentProvider theme={workspaceTheme}><ProjectHubView mode={mode} token="test-token"
    people={people} currentUserId={people[0]!.id} canCreateProject canCreateRequest canViewFunding
  /></FluentProvider>);
}

beforeEach(() => {
  vi.mocked(loadProjectHub).mockResolvedValue({ projects: [project], items: [item], requests: [] });
  vi.mocked(loadProjectHubRequests).mockResolvedValue([approved, pending]);
  vi.mocked(saveProjectHubProject).mockResolvedValue(project);
  vi.mocked(createProjectHubRequest).mockResolvedValue(pending);
  vi.mocked(decideProjectHubRequest).mockResolvedValue({ ...pending, status: "approved" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("standalone project hub", () => {
  it("shows the own project work and multiple requests without global task/payment data", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: project.title })).toBeInTheDocument();
    const work = screen.getByRole("region", { name: "Работы проекта" });
    expect(within(work).getByText("Форум")).toBeInTheDocument();
    expect(within(work).getByText(/Аренда зала · Согласовано/)).toBeInTheDocument();
    expect(within(work).getByText(/Печать баннеров · На согласовании/)).toBeInTheDocument();
    expect(screen.getByLabelText("Обзор проекта")).toHaveTextContent("300");
  });

  it("keeps the project approval order editable in its own card", async () => {
    setup();
    await screen.findByRole("heading", { name: project.title });
    fireEvent.click(screen.getByRole("button", { name: "Настроить проект" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Порядок согласующих")).toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "↓" })[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить проект" }));
    await waitFor(() => expect(saveProjectHubProject).toHaveBeenCalledWith(
      "test-token", expect.objectContaining({ approverUserIds: [people[2]!.id, people[1]!.id] }), project.id,
    ));
  });

  it("opens the separate project request decision with server-backed action", async () => {
    setup("funding");
    const card = await screen.findByRole("button", { name: /Печать баннеров/ });
    fireEvent.click(card);
    const detail = screen.getByLabelText("Карточка проектной заявки");
    expect(within(detail).getByText("Печать баннеров")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "Согласовать" }));
    await waitFor(() => expect(decideProjectHubRequest).toHaveBeenCalledWith(
      "test-token", "request-2", "approve", "",
    ));
  });
});
