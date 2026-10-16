import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageAttachmentsDialog } from "./MessageAttachmentsDialog";
beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:original");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("previews originals, edits a caption and sends only after confirmation", () => {
  const original = new File(["unmodified original"], "photo.png", { type: "image/png" });
  const send = vi.fn(), caption = vi.fn(), add = vi.fn(), remove = vi.fn(), close = vi.fn();
  render(<MessageAttachmentsDialog files={[original]} caption="Подпись" onFiles={vi.fn()} onCaption={caption}
    onAdd={add} onRemove={remove} onSend={send} onClose={close} />);
  expect(screen.getByRole("dialog", { name: "Отправка вложений" })).toBeInTheDocument();
  expect(URL.createObjectURL).toHaveBeenCalledWith(original);
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Подпись к вложениям" }), { target: { value: "Новая подпись" } });
  expect(caption).toHaveBeenCalledWith("Новая подпись");
  fireEvent.click(screen.getByRole("button", { name: "Добавить" })); expect(add).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Убрать файл photo.png" })); expect(remove).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "Отправить вложения" })); expect(send).toHaveBeenCalledOnce();
});
it("keeps file details and blocks send when upload permission disappears", () => {
  const send = vi.fn();
  render(<MessageAttachmentsDialog files={[new File(["pdf"], "file.pdf", { type: "application/pdf" })]} caption="" onFiles={vi.fn()} onCaption={vi.fn()}
    onAdd={vi.fn()} onRemove={vi.fn()} onSend={send} onClose={vi.fn()} blockedReason="Вложения запрещены" />);
  expect(screen.getByText("file.pdf")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Отправить вложения" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Вложения запрещены");
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
  expect(send).not.toHaveBeenCalled();
});
it("focuses the caption and sends on Enter without activating the default close button", async () => {
  const send = vi.fn(), close = vi.fn();
  render(<MessageAttachmentsDialog files={[new File(["doc"], "file.doc")]} caption="" onFiles={vi.fn()} onCaption={vi.fn()}
    onAdd={vi.fn()} onRemove={vi.fn()} onSend={send} onClose={close} />);
  const caption = screen.getByRole("textbox", { name: "Подпись к вложениям" });
  await waitFor(() => expect(caption).toHaveFocus());
  expect(fireEvent.keyDown(caption, { key: "Enter" })).toBe(false);
  expect(send).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(caption, { key: "Enter", shiftKey: true })).toBe(true);
  fireEvent.keyDown(caption, { key: "Enter", isComposing: true });
  fireEvent.keyDown(caption, { key: "Enter", repeat: true });
  expect(send).toHaveBeenCalledOnce();
  fireEvent.keyDown(caption, { key: "Enter", ctrlKey: true });
  expect(send).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Закрыть отправку вложений" }));
  expect(close).toHaveBeenCalledOnce();
});
