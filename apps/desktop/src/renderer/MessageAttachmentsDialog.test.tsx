import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
