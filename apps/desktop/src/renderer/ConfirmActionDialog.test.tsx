import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
function view(busy = false, confirmLabel?: string) {
  const onCancel = vi.fn(), onConfirm = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><ConfirmActionDialog open
    title="Удалить комментарий?" message="Комментарий исчезнет из обсуждения. Это действие нельзя отменить."
    busy={busy} confirmLabel={confirmLabel} onCancel={onCancel} onConfirm={onConfirm}
  /></FluentProvider>);
  return { onCancel, onConfirm, dialog: screen.getByRole("dialog", { name: "Удалить комментарий?" }) };
}
it("describes the action and keeps the only icon in the destructive button", () => {
  const { dialog } = view();
  expect(dialog).toHaveAccessibleDescription("Комментарий исчезнет из обсуждения. Это действие нельзя отменить.");
  expect(dialog.querySelector(".confirm-action-icon")).toBeNull();
  expect(dialog.querySelectorAll("svg")).toHaveLength(1);
  expect(within(dialog).getByRole("button", { name: "Удалить" }).querySelector("svg")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Отмена" }).querySelector("svg")).toBeNull();
});
it("cancels without submitting and confirms only from the delete button", () => {
  const { dialog, onCancel, onConfirm } = view();
  fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
it("allows Escape to cancel without deleting", () => {
  const { dialog, onCancel, onConfirm } = view();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});
it("keeps pending deletion locked against repeated submits, cancellation and Escape", () => {
  const { dialog, onCancel, onConfirm } = view(true);
  expect(dialog).toHaveAttribute("aria-busy", "true");
  const cancel = within(dialog).getByRole("button", { name: "Отмена" });
  const confirm = within(dialog).getByRole("button", { name: "Удаляем…" });
  expect(cancel).toBeDisabled();
  expect(confirm).toBeDisabled();
  fireEvent.click(cancel); fireEvent.click(confirm); fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});
it("preserves caller-specific action labels", () => {
  view(false, "Удалить публикацию");
  expect(screen.getByRole("button", { name: "Удалить публикацию" })).toBeInTheDocument();
});
it("restores the action and cancellation immediately after a failed pending request", () => {
  const onCancel = vi.fn(), onConfirm = vi.fn();
  const dialog = (busy: boolean, message: string) => <FluentProvider theme={workspaceTheme}>
    <ConfirmActionDialog open title="Очистить текущий чат?" message={message}
      confirmLabel="Очистить чат" busyLabel="Очищаем…" busy={busy}
      onCancel={onCancel} onConfirm={onConfirm} />
  </FluentProvider>;
  const { rerender } = render(dialog(false, "Переписка будет удалена."));
  rerender(dialog(true, "Переписка будет удалена."));
  expect(screen.getByRole("button", { name: "Очищаем…" })).toBeDisabled();
  rerender(dialog(false, "Сбой очистки"));
  const confirmation = screen.getByRole("dialog", { name: "Очистить текущий чат?" });
  expect(confirmation).toHaveAccessibleDescription("Сбой очистки");
  expect(confirmation).toHaveAttribute("aria-busy", "false");
  expect(within(confirmation).getByRole("button", { name: "Отмена" })).toBeEnabled();
  const retry = within(confirmation).getByRole("button", { name: "Очистить чат" });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
