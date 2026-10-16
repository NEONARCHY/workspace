import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { TaskDeadlineDecision } from "./TaskDeadlineDecision";
import { initialTasks, people } from "./test-fixtures/demo-data";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
const task = initialTasks[0]!;
const request = {
  id: "extension", messageId: "message", requesterUserId: people[1]!.id, status: "pending" as const,
  oldDueAt: "2026-10-20T13:00:00Z", proposedDueAt: "2026-10-22T13:00:00Z",
  reason: "Нужен документ", createdAt: "2026-10-16T10:00:00Z",
};
it("keeps refusal errors visible and allows retry without claiming a saved decision", async () => {
  const onDecide = vi.fn().mockRejectedValueOnce(new Error("Сеть недоступна")).mockResolvedValueOnce(task);
  const resolved = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><TaskDeadlineDecision task={task} request={request}
    people={people} canDecide onDecide={onDecide} onResolved={resolved} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Отказать в переносе" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
  expect(resolved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отказать в переносе" }));
  await waitFor(() => expect(resolved).toHaveBeenCalledOnce());
  expect(onDecide).toHaveBeenLastCalledWith(task, "extension", false);
});
it("shows an executor the pending request without decision controls", () => {
  render(<FluentProvider theme={workspaceTheme}><TaskDeadlineDecision task={task} request={request}
    people={people} canDecide={false} onDecide={vi.fn()} onResolved={vi.fn()} /></FluentProvider>);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Ожидает решения постановщика.")).toBeVisible();
});
