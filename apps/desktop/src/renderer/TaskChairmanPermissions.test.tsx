import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksView } from "./TasksView";
import { canManageAnyTask } from "./task-permissions";
import { workspaceTheme } from "./workspace-theme";
import {
  chairmanScenarioProps, chairmanScenarioTask, taskChairman, taskChairmanPeople,
} from "./test-fixtures/task-chairman-scenarios";

afterEach(cleanup);

function openTask(task: WorkspaceTask, person = taskChairman) {
  const props = { ...chairmanScenarioProps(task),
    people: [person, ...taskChairmanPeople.filter(item => item.id !== person.id)],
    onAcceptResult: vi.fn(), onReturnForRevision: vi.fn(), onUpdateTask: vi.fn(),
    onChangeStatus: vi.fn(), onToggleChecklistItem: vi.fn(), onSubmitResult: vi.fn(),
  };
  render(<FluentProvider theme={workspaceTheme}><TasksView {...props} /></FluentProvider>);
  return props;
}
function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Команда и настройки задачи" }));
}

describe("task blanket management matches the API", () => {
  it.each([
    ["chairman", taskChairman, false],
    ["case and surrounding whitespace", { ...taskChairman, jobTitle: `  ${taskChairman.jobTitle!.toUpperCase()}  ` }, false],
    ["ordinary manager", { ...taskChairman, jobTitle: "Rais o‘rinbosari" }, true],
    ["manager without a title", { ...taskChairman, jobTitle: undefined }, true],
    ["administrator holding chairman position", { ...taskChairman, role: "admin" }, true],
    ["superadministrator holding chairman position", { ...taskChairman, role: "superadmin" }, true],
    ["employee", { ...taskChairman, role: "employee", jobTitle: undefined }, false],
    ["missing person", undefined, false],
  ] satisfies readonly (readonly [string, WorkspacePerson | undefined, boolean])[])("%s", (_, person, expected) => {
    expect(canManageAnyTask(person)).toBe(expected);
  });
});

describe("chairman task actions", () => {
  it.each(["unrelated", "observer"])("keeps another author's task read-only when %s", relationship => {
    const task = chairmanScenarioTask({ participants: relationship === "observer"
      ? [{ userId: taskChairman.id, role: "observer" }] : [] });
    const props = openTask(task);
    expect(screen.getByText(task.resultText!)).toBeVisible();
    for (const name of ["Редактировать карточку", "Продлить срок", "Вернуть на доработку",
      "Утвердить результат", "Удалить задачу"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(document.querySelector('.task-detail input[type="file"]')).not.toBeInTheDocument();
    openSettings();
    expect(screen.queryByRole("button", { name: "Исключить из расчёта" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить цикл" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Убрать участника/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Проверить материалы" })).toBeDisabled();
    expect(props.onUpdateTask).not.toHaveBeenCalled();
    expect(props.onReturnForRevision).not.toHaveBeenCalled();
    expect(props.onAcceptResult).not.toHaveBeenCalled();
  });

  it("keeps the author's review, management and acceptance actions", async () => {
    const task = chairmanScenarioTask({ authorId: taskChairman.id });
    const props = openTask(task);
    expect(screen.getByRole("button", { name: "Редактировать карточку" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Продлить срок" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Вернуть на доработку" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Удалить задачу" })).toBeVisible();
    openSettings();
    expect(screen.getByRole("button", { name: "Исключить из расчёта" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Убрать участника/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Утвердить результат" }));
    await waitFor(() => expect(props.onAcceptResult).toHaveBeenCalledWith(task));
  });

  it.each(["assignee", "co_assignee"])("preserves executor rights when chairman is %s, not author rights", relationship => {
    const task = chairmanScenarioTask({ status: "in_progress", resultText: undefined,
      ...(relationship === "assignee" ? { assigneeId: taskChairman.id }
        : { participants: [{ userId: taskChairman.id, role: "co_assignee" }] }),
    });
    openTask(task);
    expect(screen.getByRole("button", { name: "Редактировать карточку" })).toBeVisible();
    expect(document.querySelector('.task-detail input[type="file"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершить и отправить на проверку" })).toBeDisabled();
    for (const name of ["Продлить срок", "Отменить задачу", "Утвердить результат", "Вернуть на доработку"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    openSettings();
    expect(screen.getByRole("checkbox", { name: "Проверить материалы" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Убрать участника/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Исключить из расчёта" })).not.toBeInTheDocument();
  });

  it.each(["manager", "admin", "superadmin"] as const)("preserves %s management, but acceptance still belongs to the author", role => {
    openTask(chairmanScenarioTask(), { ...taskChairman, role,
      jobTitle: role === "manager" ? "Руководитель отдела" : taskChairman.jobTitle });
    expect(screen.getByRole("button", { name: "Редактировать карточку" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Вернуть на доработку" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Продлить срок" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Утвердить результат" })).not.toBeInTheDocument();
  });

  it("keeps the chairman's result submission when he is an executor", async () => {
    const task = chairmanScenarioTask({ status: "in_progress", resultText: undefined,
      assigneeId: taskChairman.id });
    const props = openTask(task);
    fireEvent.change(screen.getByRole("textbox", { name: "Результат задачи" }), {
      target: { value: "Готовый результат" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Завершить и отправить на проверку" }));
    await waitFor(() => expect(props.onSubmitResult).toHaveBeenCalledWith(task, "Готовый результат"));
    expect(screen.queryByRole("button", { name: "Утвердить результат" })).not.toBeInTheDocument();
  });

  it("leaves an unsuccessful acceptance pending and permits retry", async () => {
    const task = chairmanScenarioTask({ authorId: taskChairman.id });
    const props = openTask(task);
    props.onAcceptResult.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Утвердить результат" }));
    await waitFor(() => expect(props.onAcceptResult).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Утвердить результат" })).toBeEnabled());
    expect(screen.getByText("На проверке")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Утвердить результат" }));
    await waitFor(() => expect(props.onAcceptResult).toHaveBeenCalledTimes(2));
  });

  it("does not broaden the author's personal review inbox", () => {
    const ownTask = chairmanScenarioTask({ id: "own", title: "Своя задача", authorId: taskChairman.id });
    const otherTask = chairmanScenarioTask({ id: "other", title: "Чужая задача" });
    render(<FluentProvider theme={workspaceTheme}><TasksView {...chairmanScenarioProps(ownTask)}
      focusTaskId={undefined} tasks={[ownTask, otherTask]} /></FluentProvider>);
    const review = screen.getByRole("button", { name: "Ждут проверки" });
    expect(review).toHaveTextContent("1");
    fireEvent.click(review);
    expect(screen.getByRole("button", { name: "Открыть задачу: Своя задача" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Открыть задачу: Чужая задача" })).not.toBeInTheDocument();
  });

  it.each([false, true])("Kanban dragging respects authorship: %s", own => {
    const task = chairmanScenarioTask({ status: "in_progress", ...(own ? { authorId: taskChairman.id } : {}) });
    render(<FluentProvider theme={workspaceTheme}><TasksView {...chairmanScenarioProps(task)}
      focusTaskId={undefined} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    const grip = screen.queryByRole("button", { name: `Перенести: ${task.title}` });
    if (own) expect(grip).toBeVisible();
    else expect(grip).not.toBeInTheDocument();
  });
});
