import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBudgetSummary, ProjectHubProject } from "@yuksalish/contracts";
import { ProjectBudgetDialog, exactBudgetMoney } from "./ProjectBudgetDialog";
import { workspaceTheme } from "./workspace-theme";
import { addProjectBudgetArticle, loadProjectBudget } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadProjectBudget: vi.fn(), addProjectBudgetArticle: vi.fn() }));
const project: ProjectHubProject = {
  id: "p1", code: "P1", title: "Test", description: "", managerUserId: "m1",
  responsibleUserIds: [], approverUserIds: [], budget: 200, currency: "UZS",
  accessStatus: "closed", lifecycleStatus: "active", approvedAmount: 0, canEdit: true,
  createdByUserId: "m1", createdAt: "2026-10-09", updatedAt: "2026-10-09",
};
const summary: ProjectBudgetSummary = {
  projectId: "p1", remainingProjectAmount: "80",
  actualByCurrency: [{ currency: "UZS", amount: "120" }, { currency: "USD", amount: "5" }],
  articles: [{ id: "a1", projectId: "p1", title: "Services", amount: "100.50", currency: "UZS",
    funding: "donor", actualAmount: "120", remainingAmount: "-19.50" }],
};
function setup(canEdit = true) {
  return render(<FluentProvider theme={workspaceTheme}><ProjectBudgetDialog token="test"
    project={{ ...project, canEdit }} onClose={vi.fn()} /></FluentProvider>);
}
beforeEach(() => { vi.mocked(loadProjectBudget).mockResolvedValue(summary); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("actual project budget", () => {
  it("keeps large decimal strings exact", () => {
    expect(exactBudgetMoney("9007199254740990.123456789012", "UZS"))
      .toBe("9 007 199 254 740 990,123456789012 UZS");
  });
  it("shows plan, actual, negative remainder and currencies independently", async () => {
    setup();
    expect(await screen.findByRole("rowheader", { name: /Services/ })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "100,50 UZS" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "-19,50 UZS" })).toBeInTheDocument();
    expect(screen.getByText("5 USD")).toBeInTheDocument();
    expect(screen.getByText(/Исторические завершённые заявки/)).toBeInTheDocument();
  });
  it("leaves article input and creation key available for retry after failure", async () => {
    setup();
    await screen.findByRole("rowheader", { name: /Services/ });
    fireEvent.click(screen.getByRole("button", { name: "Добавить статью" }));
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "New article" } });
    fireEvent.change(screen.getByLabelText("Плановая сумма"), { target: { value: "0.25" } });
    vi.mocked(addProjectBudgetArticle).mockRejectedValue(new Error("Сеть недоступна"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить статью" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(screen.getByLabelText("Плановая сумма")).toHaveValue("0.25");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить статью" }));
    await waitFor(() => expect(addProjectBudgetArticle).toHaveBeenCalledTimes(2));
    expect(vi.mocked(addProjectBudgetArticle).mock.calls[1]?.[2].idempotencyKey)
      .toBe(vi.mocked(addProjectBudgetArticle).mock.calls[0]?.[2].idempotencyKey);
  });
  it("does not offer plan changes to a read-only project viewer", async () => {
    setup(false);
    await screen.findByRole("rowheader", { name: /Services/ });
    expect(screen.queryByRole("button", { name: "Добавить статью" })).not.toBeInTheDocument();
  });
  it("shows a retry after a load failure, not an invented balance", async () => {
    vi.mocked(loadProjectBudget).mockRejectedValueOnce(new Error("Недоступно"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Недоступно");
    expect(screen.queryByText("80 UZS")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Обновить бюджет" }));
    expect(await screen.findByRole("rowheader", { name: /Services/ })).toBeInTheDocument();
  });
});
