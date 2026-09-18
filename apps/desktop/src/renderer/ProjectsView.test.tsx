import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceProject } from "@yuksalish/contracts";
import { workspaceTheme } from "./workspace-theme";
import { ProjectsView } from "./ProjectsView";
import { people } from "./test-fixtures/demo-data";

const project: WorkspaceProject = { id: "qa-project", code: "YUK-26", title: "Региональная программа", description: "Описание",
  managerUserId: people[0]!.id, budget: 100000, spentBudget: 20000, remainingBudget: 80000, currency: "UZS",
  status: "in_progress", stage: "approval", createdByUserId: people[0]!.id, createdAt: "2026-09-04", updatedAt: "2026-09-04", canEdit: true, canMove: true, history: [] };
function setup(onCreate = vi.fn(async () => undefined as WorkspaceProject | undefined), projects: WorkspaceProject[] = [], currentUser = people[0]!) {
  const onUpdate = vi.fn(async () => project);
  const onMove = vi.fn(async () => undefined as WorkspaceProject | undefined);
  render(<FluentProvider theme={workspaceTheme}><ProjectsView projects={projects} people={people} currentUser={currentUser} onCreate={onCreate} onUpdate={onUpdate} onMove={onMove} /></FluentProvider>);
  return { onCreate, onUpdate, onMove };
}
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Новый проект" }));
afterEach(cleanup);
describe("Project composer", () => {
  it("filters the board without changing projects and exposes exact overview counts", () => {
    const completed = { ...project, id: "done-project", code: "DONE", title: "Завершённый проект", status: "completed" as const, stage: "success" as const, canMove: false };
    setup(undefined, [project, completed]);
    expect(screen.getByLabelText("Сводка по проектам")).toHaveTextContent("1завершено");
    expect(document.querySelectorAll(".project-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Все.*2/ }));
    expect(document.querySelectorAll(".project-card")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Поиск проектов"), { target: { value: "DONE" } });
    expect(document.querySelectorAll(".project-card")).toHaveLength(1);
    expect(screen.getByText("Завершённый проект")).toBeInTheDocument();
  });
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
  it("offers every other stage to an administrator", () => {
    const { onMove } = setup(undefined, [project], people[3]!);
    fireEvent.click(screen.getByText(project.title));
    const start = screen.getByRole("button", { name: "Начало" });
    expect(start).toHaveAttribute("data-direction", "back");
    expect(screen.getByRole("button", { name: "Подготовка" })).toHaveAttribute("data-direction", "back");
    expect(screen.getByRole("button", { name: "Успех" })).toHaveAttribute("data-direction", "forward");
    expect(screen.getByRole("button", { name: "Провал" })).toHaveAttribute("data-direction", "forward");
    fireEvent.click(start);
    expect(onMove).toHaveBeenCalledWith(project, "start");
  });
});
