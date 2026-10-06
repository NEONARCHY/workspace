import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UndoActionsProvider, useUndoActions } from "./UndoActions";

afterEach(() => { cleanup(); vi.useRealTimers(); });
function Controls({ commit }: { commit: () => Promise<void> }) {
  const undo = useUndoActions();
  return <>{["one", "two"].map(id => <button key={id} onClick={() => undo.enqueue({ id, scope: "chat", label: id, commit })}>{`Удалить ${id}`}</button>)}</>;
}
it("keeps each action cancellable until exactly five seconds and does not reset on rerender", async () => {
  vi.useFakeTimers();
  const commit = vi.fn().mockResolvedValue(undefined);
  const view = render(<UndoActionsProvider><Controls commit={commit} /></UndoActionsProvider>);
  fireEvent.click(screen.getByText("Удалить one"));
  await act(() => vi.advanceTimersByTimeAsync(4_999));
  view.rerender(<UndoActionsProvider><Controls commit={commit} /></UndoActionsProvider>);
  expect(commit).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(commit).toHaveBeenCalledOnce();
});
it("supports independent undo for multiple actions and deduplicates repeated requests", async () => {
  vi.useFakeTimers();
  const commit = vi.fn().mockResolvedValue(undefined);
  render(<UndoActionsProvider><Controls commit={commit} /></UndoActionsProvider>);
  fireEvent.click(screen.getByText("Удалить one"));
  fireEvent.click(screen.getByText("Удалить one"));
  fireEvent.click(screen.getByText("Удалить two"));
  expect(screen.getAllByText("Вернуть")).toHaveLength(2);
  fireEvent.click(within(screen.getByText("one").closest(".workspace-undo-toast") as HTMLElement).getByText("Вернуть"));
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(commit).toHaveBeenCalledOnce();
});
it("survives section switches, but cancels unsent actions when the authenticated provider unmounts", async () => {
  vi.useFakeTimers();
  const commit = vi.fn().mockResolvedValue(undefined);
  const view = render(<UndoActionsProvider><Controls commit={commit} /></UndoActionsProvider>);
  fireEvent.click(screen.getByText("Удалить one"));
  view.rerender(<UndoActionsProvider><p>Другой раздел</p></UndoActionsProvider>);
  expect(screen.getByText("Вернуть")).toBeVisible();
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(commit).not.toHaveBeenCalled();
});
it("restores pending visibility and reports a failed commit", async () => {
  vi.useFakeTimers();
  const commit = vi.fn().mockRejectedValue(new Error("Сервер недоступен"));
  render(<UndoActionsProvider><Controls commit={commit} /></UndoActionsProvider>);
  fireEvent.click(screen.getByText("Удалить one"));
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByRole("alert")).toHaveTextContent("Сервер недоступен");
  expect(screen.queryByText("Вернуть")).not.toBeInTheDocument();
});
