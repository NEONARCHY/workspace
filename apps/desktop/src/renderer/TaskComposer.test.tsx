import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";

import { TaskComposer } from "./TaskComposer";
import { people } from "./test-fixtures/demo-data";
import type { WorkspaceDepartment } from "@yuksalish/contracts";

const taskDepartments: readonly WorkspaceDepartment[] = [{
  id: "central-team", code: "central-team", name: "Проектный отдел", scope: "central",
  assignedUsersCount: 3, memberIds: ["aziza", "baxtiyor", "dilshod"], leadUserId: "baxtiyor",
}];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("prefills a suggested task but never submits without the user", () => {
  const onSubmit = vi.fn();
  render(<FluentProvider theme={webLightTheme}>
    <TaskComposer open people={people} tasks={[]} currentUserId="aziza"
      initialTitle="Проверить письмо" initialDescription="До пятницы"
      onClose={vi.fn()} onSubmit={onSubmit} />
  </FluentProvider>);
  expect(screen.getByRole("textbox", { name: "Название задачи" })).toHaveValue("Проверить письмо");
  expect(screen.getByRole("textbox", { name: "Описание новой задачи" })).toHaveValue("До пятницы");
  expect(onSubmit).not.toHaveBeenCalled();
});

it("restores a task draft, then deletes the local copy", async () => {
  const loadDraft = vi.fn().mockResolvedValue(JSON.stringify({
    title: "Продолжить задачу", description: "Результат", project: "Команда",
  }));
  const clearDraft = vi.fn().mockResolvedValue(undefined);
  const saveDraft = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("yuksalish", { loadDraft, clearDraft, saveDraft });

  render(<FluentProvider theme={webLightTheme}>
    <TaskComposer open people={people} tasks={[]} currentUserId="aziza"
      onClose={vi.fn()} onSubmit={vi.fn()} />
  </FluentProvider>);

  await waitFor(() => expect(screen.getByRole("textbox", { name: "Название задачи" })).toHaveValue("Продолжить задачу"));
  expect(loadDraft).toHaveBeenCalledWith("task:aziza");
  await waitFor(() => expect(clearDraft).toHaveBeenCalledWith("task:aziza"));
  expect(saveDraft).not.toHaveBeenCalled();
});

it("flushes the new task draft before a web update reload", async () => {
  const loadDraft = vi.fn().mockResolvedValue(null);
  const saveDraft = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("yuksalish", {
    loadDraft,
    clearDraft: vi.fn().mockResolvedValue(undefined),
    saveDraft,
  });

  render(<FluentProvider theme={webLightTheme}>
    <TaskComposer open people={people} tasks={[]} currentUserId="aziza"
      onClose={vi.fn()} onSubmit={vi.fn()} />
  </FluentProvider>);

  await waitFor(() => expect(loadDraft).toHaveBeenCalledWith("task:aziza"));
  fireEvent.change(screen.getByRole("textbox", { name: "Название задачи" }), {
    target: { value: "Задача перед обновлением" },
  });
  window.dispatchEvent(new Event("yuksalish:prepare-web-update"));
  await waitFor(() => expect(saveDraft).toHaveBeenCalledWith(
    "task:aziza",
    expect.stringContaining('"title":"Задача перед обновлением"'),
  ));
});

it("adds an individual participant from the compact team browser", () => {
  render(<FluentProvider theme={webLightTheme}>
    <TaskComposer open people={people} departments={taskDepartments} tasks={[]} currentUserId="aziza"
      initialTitle="Подготовить документ" onClose={vi.fn()} onSubmit={vi.fn()} />
  </FluentProvider>);

  fireEvent.click(screen.getByText("Команда", { selector: "summary strong" }));
  expect(screen.getByRole("group", { name: "Доступные сотрудники" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Бахтиёр Самугов/ }));
  fireEvent.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
  expect(screen.getByRole("button", { name: "Убрать участника Бахтиёр Самугов" })).toBeInTheDocument();
});

it("uses the department lead when the whole department becomes responsible", async () => {
  const onSubmit = vi.fn().mockResolvedValue({ id: "created" });
  render(<FluentProvider theme={webLightTheme}>
    <TaskComposer open people={people} departments={taskDepartments} tasks={[]} currentUserId="aziza"
      initialTitle="Подготовить документ" onClose={vi.fn()} onSubmit={onSubmit} />
  </FluentProvider>);

  fireEvent.click(screen.getByText("Команда", { selector: "summary strong" }));
  fireEvent.click(screen.getByRole("button", { name: "Отдел целиком" }));
  fireEvent.click(screen.getByRole("button", { name: /Проектный отдел/ }));
  fireEvent.click(screen.getByRole("button", { name: "Назначить отдел ответственным" }));
  fireEvent.click(screen.getByRole("button", { name: "Добавить задачу" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    assigneeId: "baxtiyor",
    participants: expect.arrayContaining([
      { userId: "aziza", role: "co_assignee" },
      { userId: "dilshod", role: "co_assignee" },
    ]),
  })));
});
