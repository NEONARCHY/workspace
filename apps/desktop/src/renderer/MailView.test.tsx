import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { MailConnection, MailMessage } from "@yuksalish/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailView } from "./MailView";

const api = vi.hoisted(() => ({ connection: vi.fn(), messages: vi.fn(), thread: vi.fn(), drafts: vi.fn(), projects: vi.fn() }));
vi.mock("./workspace-api", () => ({ loadMailConnection: api.connection, loadMailMessages: api.messages,
  loadMailThread: api.thread, loadMailDrafts: api.drafts, loadTaskProjectOptions: api.projects }));
vi.mock("./TaskComposer", () => ({ TaskComposer: ({initialDescription}: {initialDescription: string}) => <div role="dialog" aria-label="Создание задачи">{initialDescription}</div> }));
vi.mock("./MailComposer", () => ({ MailComposer: () => null, mailStateLabels: {} }));
vi.mock("./mail-preview", () => ({ MailAttachmentViewer: () => null, mailFilePreviewable: () => false }));
const connection: MailConnection = { accountId: "own-account", email: "owner@gmail.com", configured: true,
  sendingEnabled: false, connectedAt: "2026-10-20T12:00:00Z", reconnectRequired: false };
const message: MailMessage = { id: "message-1", threadId: "thread-1", subject: "Бюджет проекта", sender: "donor@example.com",
  recipients: "owner@gmail.com", receivedAt: "2026-10-20T12:00:00Z", snippet: "Только выбранное письмо", unread: true,
  body: '<img src="https://tracking.example/pixel">Приватный текст', messageId: "<one@example.com>", references: "", replyTo: "",
  attachments: [{ id: "file-1", fileName: "budget.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 100 }] };
function show() {
  return render(<FluentProvider theme={webLightTheme}><MailView token="test-token" currentUserId="owner" people={[]} departments={[]} tasks={[]}
    canCreate canEdit canCreateTask canUseSigned onTaskCreated={vi.fn()} /></FluentProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); api.connection.mockResolvedValue(connection); api.messages.mockResolvedValue({ messages: [message], nextPageToken: null });
  api.thread.mockResolvedValue({ messages: [message], truncated: false }); api.drafts.mockResolvedValue([]); api.projects.mockResolvedValue([]);
});
afterEach(cleanup);
it("explains missing server setup without pretending the employee is connected", async () => {
  api.connection.mockResolvedValue({ ...connection, configured: false, accountId: null, email: null }); show();
  expect(await screen.findByText(/Почта ещё не настроена/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Подключить Gmail" })).toBeDisabled();
  expect(api.messages).not.toHaveBeenCalled();
});
it("renders mail as inert text and asks which content to share before composing a task", async () => {
  show(); fireEvent.click(await screen.findByRole("button", { name: /donor@example.com.*Бюджет проекта/ }));
  expect(await screen.findByText(message.body)).toBeInTheDocument();
  expect(document.querySelector('img[src*="tracking.example"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Создать задачу" }));
  const selection = await screen.findByRole("dialog", { name: "Что передать в задачу" });
  expect(within(selection).getByRole("checkbox", { name: "budget.xlsx" })).not.toBeChecked();
  fireEvent.click(within(selection).getByRole("checkbox", { name: "Включить текст выбранного письма" }));
  fireEvent.click(within(selection).getByRole("button", { name: "Перейти к созданию задачи" }));
  const composer = await screen.findByRole("dialog", { name: "Создание задачи" });
  expect(composer).toHaveTextContent("Бюджет проекта"); expect(composer).not.toHaveTextContent("Приватный текст");
});
