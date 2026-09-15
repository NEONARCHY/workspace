import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceProject } from "@yuksalish/contracts";
import { workspaceTheme } from "./workspace-theme";
import { ProjectsView } from "./ProjectsView";
import { people } from "./demo-data";

const project: WorkspaceProject = { id: "qa-project", code: "YUK-26", title: "Региональная программа", description: "Описание",
  managerUserId: people[0]!.id, budget: 100000, spentBudget: 20000, remainingBudget: 80000, currency: "UZS",
  status: "in_progress", stage: "approval", createdByUserId: people[0]!.id, createdAt: "2026-09-04", updatedAt: "2026-09-04", canEdit: true, canMove: true, canDelete: true, history: [] };
function setup(onCreate = vi.fn(async () => undefined as WorkspaceProject | undefined), projects: WorkspaceProject[] = []) {
  const onUpdate = vi.fn(async () => project);
  const onDelete = vi.fn(async () => true);
  render(<FluentProvider theme={workspaceTheme}><ProjectsView projects={projects} people={people} currentUser={people[0]!} onCreate={onCreate} onUpdate={onUpdate} onMove={vi.fn()} onDelete={onDelete} /></FluentProvider>);
  return { onCreate, onUpdate, onDelete };
}
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Новый проект" }));
afterEach(cleanup);
describe("Project composer", () => {
  it("groups fields and recalculates the remainder in the selected currency", () => {
    setup(); open(); change("Название проекта", "Региональные инициативы"); change("Бюджет проекта", "14500"); change("Потрачено", "2500"); change("Валюта проекта", "USD");
    expect(screen.getByLabelText("Оставшийся бюджет").textContent?.replace(/\s/g, "")).toBe("12000USD");
    expect(within(screen.getByLabelText("Сводка карточки")).getByText("Региональные инициативы")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Сроки и ответственность" })).toBeInTheDocument();
  });
  it("rejects invalid amounts, empty mandatory fields and reversed dates", () => {
    const { onCreate } = setup(); open(); fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Укажите код");
    change("Код проекта", "QA"); change("Название проекта", "Тест"); change("Потрачено", "1");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" })); expect(onCreate).not.toHaveBeenCalled();
    change("Бюджет проекта", "200"); change("Начало проекта", "2026-09-20"); change("Окончание проекта", "2026-09-19");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" })); expect(screen.getByRole("alert")).toHaveTextContent("Дата окончания");
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("preserves entered values on failure and prevents duplicate submissions", async () => {
    let finish!: (value: WorkspaceProject | undefined) => void;
    const create = vi.fn(() => new Promise<WorkspaceProject | undefined>((resolve) => { finish = resolve; }));
    setup(create); open(); change("Код проекта", " QA "); change("Название проекта", " Тест ");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    fireEvent.submit(screen.getByRole("dialog")); expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled(); finish(undefined);
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить");
    expect(screen.getByLabelText("Название проекта")).toHaveValue(" Тест ");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Тест", code: "QA", currency: "UZS" }));
  });
  it("keeps the existing stage and uses the update contract when editing", async () => {
    const { onUpdate, onCreate } = setup(undefined, [project]); fireEvent.click(screen.getByText(project.title)); fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(screen.getByLabelText("Стадии проекта").querySelector('[aria-current="step"]')).toHaveTextContent("Согласование");
    change("Название проекта", "Уточнённый проект"); fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1)); expect(onCreate).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(project, { code: project.code, title: "Уточнённый проект", description: project.description, managerUserId: project.managerUserId, startDate: null, endDate: null, budget: 100000, spentBudget: 20000, currency: "UZS" });
  });
  it("requires a reason before deleting a project", async () => {
    const { onDelete } = setup(undefined, [project]);
    fireEvent.click(screen.getByText(project.title));
    fireEvent.click(screen.getByRole("button", { name: "Удалить проект" }));
    fireEvent.change(screen.getByLabelText("Причина решения"), {
      target: { value: "Проект создан ошибочно" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить решение" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(project, "Проект создан ошибочно"));
  });
});
