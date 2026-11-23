import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksView } from "./TasksView";
import { workspaceTheme } from "./workspace-theme";
import {
  chairmanScenarioProps, chairmanScenarioTask, taskChairman, taskChairmanPeople,
} from "./test-fixtures/task-chairman-scenarios";

afterEach(cleanup);

function openDeadlineTask(role: WorkspacePerson["role"], author = false, pending = false) {
  const person = { ...taskChairman, role };
  const base = chairmanScenarioTask({
    status: "in_progress", assigneeId: person.id,
    authorId: author ? person.id : "qa-author",
  });
  const task: WorkspaceTask = pending ? { ...base, deadlineRequests: [{
    id: "extension", messageId: "extension-message", requesterUserId: person.id,
    oldDueAt: base.dueAt!, proposedDueAt: "2100-01-02T12:00:00Z",
    reason: "Нужны материалы", status: "pending", createdAt: new Date().toISOString(),
  }] } : base;
  const props = {
    ...chairmanScenarioProps(task),
    people: [person, ...taskChairmanPeople.filter(item => item.id !== person.id)],
    onRequestDeadline: vi.fn().mockResolvedValue(task),
    onExtendDeadline: vi.fn().mockResolvedValue(task), onDecideDeadline: vi.fn(),
  };
  render(<FluentProvider theme={workspaceTheme}><TasksView {...props} /></FluentProvider>);
  return { props, task };
}

describe("Only the task author changes deadlines", () => {
  it.each(["employee", "manager", "admin", "superadmin"] as const)(
    "%s executor requests approval and cannot change the date or approve itself", role => {
      const { props } = openDeadlineTask(role);
      expect(screen.queryByRole("button", { name: "Продлить срок" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Запросить продление" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
      expect(screen.getByRole("button", { name: "Срок задачи: открыть выбор" })).toBeDisabled();
      expect(props.onExtendDeadline).not.toHaveBeenCalled();
    },
  );

  it.each(["employee", "manager", "admin", "superadmin"] as const)(
    "%s author retains direct date editing", role => {
      openDeadlineTask(role, true);
      expect(screen.getByRole("button", { name: "Продлить срок" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Запросить продление" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
      expect(screen.getByRole("button", { name: "Срок задачи: открыть выбор" })).toBeEnabled();
    },
  );

  it.each(["employee", "manager", "admin", "superadmin"] as const)(
    "%s non-author cannot decide a pending extension", role => {
      openDeadlineTask(role, false, true);
      expect(screen.getByText("Ожидает решения постановщика.")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Согласовать перенос срока" }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Отказать в переносе" }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Запросить продление" }))
        .not.toBeInTheDocument();
    },
  );

  it("requires a reason, keeps the draft after an error and prevents duplicate requests", async () => {
    const { props, task } = openDeadlineTask("manager");
    let finish: ((updated: WorkspaceTask) => void) | undefined;
    props.onRequestDeadline.mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockImplementationOnce(() => new Promise<WorkspaceTask>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Запросить продление" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить постановщику" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Укажите причину");
    expect(props.onRequestDeadline).not.toHaveBeenCalled();
    const reason = screen.getByRole("textbox", { name: "Причина переноса срока" });
    act(() => reason.focus());
    fireEvent.change(reason, { target: { value: "Ожидаем материалы" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить постановщику" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(reason).toHaveValue("Ожидаем материалы");
    const submit = await screen.findByRole("button", { name: "Отправить постановщику" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(props.onRequestDeadline).toHaveBeenCalledTimes(2);
    expect(props.onRequestDeadline).toHaveBeenLastCalledWith(
      task, expect.any(String), "Ожидаем материалы",
    );
    expect(props.onExtendDeadline).not.toHaveBeenCalled();
    await act(async () => { finish?.(task); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Запрос продления срока" }))
      .not.toBeInTheDocument());
  });
});
