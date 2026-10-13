import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { AttachmentPanel } from "./AttachmentPanel";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
const file = (id: string, uploader = "me"): WorkspaceAttachment => ({ id, ownerType: "task", ownerId: "task",
  fileName: `${id}.pdf`, contentType: "application/pdf", byteSize: 100, sha256: "hash", uploadedByUserId: uploader,
  documentRole: "general", createdAt: "2026-10-13T00:00:00Z" });
const wrap = (node: React.ReactNode) => <FluentProvider theme={workspaceTheme}>{node}</FluentProvider>;

it.each([false, true])("offers own files only, or every file for admin=%s", admin => {
  render(wrap(<AttachmentPanel attachments={[file("own"), file("other", "colleague")]} canUpload={false}
    onUpload={vi.fn()} onDownload={vi.fn()} canDelete={item => admin || item.uploadedByUserId === "me"} onDelete={vi.fn()} />));
  expect(screen.getByRole("button", { name: "Удалить файл: own.pdf" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Удалить файл: other.pdf" }) !== null).toBe(admin);
});
it("requires confirmation, disables repeat actions and leaves removal to confirmed server state", async () => {
  let complete!: () => void;
  const remove = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const view = render(wrap(<AttachmentPanel attachments={[file("own")]} canUpload={false}
    onUpload={vi.fn()} onDownload={vi.fn()} canDelete={() => true} onDelete={remove} />));
  fireEvent.click(screen.getByRole("button", { name: "Удалить файл: own.pdf" }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Удаляем…" })).toBeDisabled();
  await act(async () => complete());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByTitle(/Открыть: own.pdf/)).toBeInTheDocument();
  view.rerender(wrap(<AttachmentPanel attachments={[]} canUpload={false} onUpload={vi.fn()} onDownload={vi.fn()} />));
  expect(screen.getByText("Файлов пока нет")).toBeInTheDocument();
});
it("keeps the file and shows a retryable error after server refusal", async () => {
  render(wrap(<AttachmentPanel attachments={[file("own")]} canUpload={false} onUpload={vi.fn()} onDownload={vi.fn()}
    canDelete={() => true} onDelete={vi.fn().mockRejectedValue(new Error("Нет права удаления"))} />));
  fireEvent.click(screen.getByRole("button", { name: "Удалить файл: own.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Нет права удаления");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByTitle(/Открыть: own.pdf/)).toBeInTheDocument();
});
it("accepts all 50 selected files and displays every previously attached file", async () => {
  const upload = vi.fn();
  render(wrap(<AttachmentPanel attachments={Array.from({length: 50}, (_, index) => file(`file-${index}`))}
    canUpload onUpload={upload} onDownload={vi.fn()} />));
  const files = Array.from({length: 50}, (_, index) => new File(["test"], `${index}.pdf`));
  fireEvent.change(screen.getByLabelText("Добавить файлы: Вложения"), {target: {files}});
  await waitFor(() => expect(upload).toHaveBeenCalledWith(files));
  expect(screen.getAllByTitle(/Открыть: file-/)).toHaveLength(50);
});
