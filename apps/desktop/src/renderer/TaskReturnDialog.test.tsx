import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskReturnDialog } from "./TaskReturnDialog";
import { TasksView } from "./TasksView";
import { workspaceTheme } from "./workspace-theme";
import { chairmanScenarioProps, chairmanScenarioTask } from "./test-fixtures/task-chairman-scenarios";

afterEach(cleanup);

function renderReturn(onSubmit = vi.fn(async () => true)) {
  const onClose = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><TaskReturnDialog open taskTitle="Проверить договор"
    onClose={onClose} onSubmit={onSubmit} /></FluentProvider>);
  return { onSubmit, onClose };
}

describe("task return dialog", () => {
  it("opens above the task card and sends the reason through the existing action", async () => {
    const task = chairmanScenarioTask();
    const onReturnForRevision = vi.fn(async () => ({ ...task, status: "in_progress" as const }));
    render(<FluentProvider theme={workspaceTheme}><TasksView {...chairmanScenarioProps(task)}
      currentUserId={task.authorId} onReturnForRevision={onReturnForRevision} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Вернуть на доработку" }));
    const dialog = screen.getByRole("dialog", { name: "Вернуть на доработку" });
    expect(within(dialog).getByText(task.title)).toBeVisible();
    const explanation = within(dialog).getByRole("textbox", { name: "Пояснение причины" });
    await waitFor(() => expect(explanation).toHaveFocus());
    fireEvent.change(explanation, { target: { value: "  Добавьте номер договора  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Вернуть исполнителям" }));
    await waitFor(() => expect(onReturnForRevision).toHaveBeenCalledWith(task, "corrections_required", "Добавьте номер договора"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Вернуть на доработку" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Закрыть задачу" })).toBeInTheDocument();
  });

  it("requires an explanation for other reasons and keeps the dialog open", async () => {
    const { onSubmit, onClose } = renderReturn();
    fireEvent.change(screen.getByRole("combobox", { name: "Причина возврата" }), { target: { value: "other" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Пояснение причины" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть исполнителям" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Для другой причины добавьте пояснение");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("retains the reason and text after a refused action and permits an explicit retry", async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onClose } = renderReturn(onSubmit);
    fireEvent.change(screen.getByRole("combobox", { name: "Причина возврата" }), { target: { value: "incomplete_result" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Пояснение причины" }), { target: { value: "Приложите расчёт" } });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть исполнителям" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось вернуть задачу");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Пояснение причины" })).toHaveValue("Приложите расчёт");
    expect(screen.getByRole("combobox", { name: "Причина возврата" })).toHaveValue("incomplete_result");
    fireEvent.click(screen.getByRole("button", { name: "Вернуть исполнителям" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("shows a thrown error inside the dialog without losing the draft", async () => {
    renderReturn(vi.fn(async () => { throw new Error("Недостаточно прав для возврата."); }));
    fireEvent.change(screen.getByRole("textbox", { name: "Пояснение причины" }), { target: { value: "Уточните выводы" } });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть исполнителям" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Недостаточно прав для возврата");
    expect(screen.getByRole("textbox", { name: "Пояснение причины" })).toHaveValue("Уточните выводы");
  });

  it("locks repeated submits and closing while the request is pending", async () => {
    let finish!: (value: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { onClose } = renderReturn(onSubmit);
    const button = screen.getByRole("button", { name: "Вернуть исполнителям" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Закрыть окно возврата" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Пояснение причины" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    finish(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("cancels without sending the task", () => {
    const { onClose, onSubmit } = renderReturn();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not offer the action to an executor or for an unsubmitted task", () => {
    const task = chairmanScenarioTask({ status: "in_progress" });
    render(<FluentProvider theme={workspaceTheme}><TasksView {...chairmanScenarioProps(task)} currentUserId={task.assigneeId} /></FluentProvider>);
    expect(screen.queryByRole("button", { name: "Вернуть на доработку" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Вернуть на доработку" })).not.toBeInTheDocument();
  });
});
