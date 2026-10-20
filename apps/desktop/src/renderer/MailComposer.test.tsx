import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { MailDraft } from "@yuksalish/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailComposer } from "./MailComposer";
const api = vi.hoisted(() => ({ save: vi.fn(), send: vi.fn(), reconcile: vi.fn() }));
vi.mock("./workspace-api", () => ({ saveMailDraft: api.save, sendMailDraft: api.send, reconcileMailDraft: api.reconcile }));
vi.mock("./mail-preview", () => ({ MailAttachmentViewer: () => null, mailFilePreviewable: () => false }));
const draft: MailDraft = { id: "draft-1", to: ["recipient@example.com"], cc: [], bcc: [], subject: "Проверенное письмо", body: "Наш текст",
  status: "draft", revision: 2, attachments: [], providerMessageId: null, error: "", updatedAt: "2026-10-20T12:00:00Z", replyMessageId: null };
function show(value = draft) {
  render(<FluentProvider theme={webLightTheme}><MailComposer token="token" email="owner@gmail.com" seed={{ id: value.id, draft: value, fields: value }}
    canEdit sendingEnabled canUseSigned={false} onClose={vi.fn()} onSaved={vi.fn()} /></FluentProvider>);
}
beforeEach(() => { vi.clearAllMocks(); api.save.mockResolvedValue({ ...draft, revision: 3 }); });
afterEach(cleanup);
it("requires a separate full preview and blocks duplicate send clicks; a timeout is not success", async () => {
  api.send.mockRejectedValue(new Error("Результат запроса неизвестен")); show();
  expect(api.send).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Предпросмотр и отправка" }));
  const confirm = await screen.findByRole("button", { name: "Подтвердить отправку через Gmail" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Закрыть редактор" })).toHaveFocus());
  expect(screen.getByRole("article", { name: "Предпросмотр исходящего письма" })).toHaveTextContent("recipient@example.com");
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(await screen.findByRole("alert")).toHaveTextContent("Результат запроса неизвестен"); expect(api.send).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить отправку через Gmail" }));
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
  expect(api.send.mock.calls[1]).toEqual(api.send.mock.calls[0]); // same operation, never a new send
});
it("preserves local edits on save conflict and never advances to sending", async () => {
  api.save.mockRejectedValue(new Error("Черновик изменён в другом окне")); show();
  fireEvent.change(screen.getByRole("textbox", { name: "Текст письма" }), { target: { value: "Мой несохранённый текст" } });
  fireEvent.click(screen.getByRole("button", { name: "Предпросмотр и отправка" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Черновик изменён");
  expect(screen.getByRole("textbox", { name: "Текст письма" })).toHaveValue("Мой несохранённый текст"); expect(api.send).not.toHaveBeenCalled();
});
it("does not offer a resend for an unknown provider result", () => {
  show({ ...draft, status: "unknown", error: "Проверьте Отправленные" });
  expect(screen.queryByRole("button", { name: "Предпросмотр и отправка" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Проверить папку «Отправленные»" })).toBeInTheDocument();
});
