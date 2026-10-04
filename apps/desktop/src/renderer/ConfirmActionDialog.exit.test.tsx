import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dialog, FluentProvider, type DialogProps } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { workspaceTheme } from "./workspace-theme";

// jsdom completes Fluent exit presence immediately. Keep the real surface mounted
// to inspect the props it receives throughout that otherwise invisible exit phase.
vi.mock("./WorkspaceDialog", () => ({
  WorkspaceDialog: (props: DialogProps) => <Dialog {...props} open />,
}));

afterEach(cleanup);
const publication = {
  title: "Удалить публикацию?",
  message: "Публикация «Новости команды» и её обсуждение будут удалены без возможности восстановления.",
};
const comment = {
  title: "Удалить комментарий?",
  message: "Комментарий исчезнет из обсуждения. Это действие нельзя отменить.",
};
const actions = { onCancel: vi.fn(), onConfirm: vi.fn() };
function node(open: boolean, content = publication, busy = false, confirmLabel = "Удалить", busyLabel = "Удаляем…") {
  return <FluentProvider theme={workspaceTheme}><ConfirmActionDialog open={open}
    {...content} {...actions} busy={busy} confirmLabel={confirmLabel} busyLabel={busyLabel}
  /></FluentProvider>;
}

it("does not replace the publication with fallback comment text while closing", () => {
  const { rerender } = render(node(true));
  rerender(node(false, comment));
  const dialog = screen.getByRole("dialog", { name: publication.title });
  expect(dialog).toHaveAccessibleDescription(publication.message);
  expect(screen.queryByText(comment.title)).not.toBeInTheDocument();
  rerender(node(false, { title: "", message: "" }));
  expect(dialog).toHaveAccessibleDescription(publication.message);
});

it("keeps the latest open content, including changes immediately before closing", () => {
  const { rerender } = render(node(true));
  const updated = { ...publication, message: "Публикация «Обновлённые новости» будет удалена." };
  rerender(node(true, updated));
  rerender(node(false, comment));
  expect(screen.getByRole("dialog", { name: publication.title })).toHaveAccessibleDescription(updated.message);
});

it("uses fresh content immediately when reopened for a different action", () => {
  const { rerender } = render(node(true));
  rerender(node(false, comment));
  rerender(node(true, comment));
  expect(screen.getByRole("dialog", { name: comment.title })).toHaveAccessibleDescription(comment.message);
  rerender(node(false));
  expect(screen.getByRole("dialog", { name: comment.title })).toHaveAccessibleDescription(comment.message);
});

it("retains the pending state and custom action labels throughout a successful close", () => {
  const { rerender } = render(node(true, publication, false, "Удалить публикацию", "Удаляем публикацию…"));
  rerender(node(true, publication, true, "Удалить публикацию", "Удаляем публикацию…"));
  rerender(node(false, comment));
  const dialog = screen.getByRole("dialog", { name: publication.title });
  expect(dialog).toHaveAttribute("aria-busy", "true");
  expect(within(dialog).getByRole("button", { name: "Удаляем публикацию…" })).toBeDisabled();
});

it("does not dispatch actions from a surface that is already closing", () => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><ConfirmActionDialog open={false}
    {...publication} onConfirm={onConfirm} onCancel={onCancel}
  /></FluentProvider>);
  const dialog = screen.getByRole("dialog", { name: publication.title });
  fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});
