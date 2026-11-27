import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { MailConnection, MailMessage } from "@yuksalish/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailView } from "./MailView";
import { disposeTabster, getTabster } from "tabster";
import { mockVisibleWindowLayout } from "./test-fixtures/visible-window";

const api = vi.hoisted(() => ({ connection: vi.fn(), messages: vi.fn(), thread: vi.fn(), drafts: vi.fn(), projects: vi.fn() }));
vi.mock("./workspace-api", () => ({ loadMailConnection: api.connection, loadMailMessages: api.messages,
  loadMailThread: api.thread, loadMailDrafts: api.drafts, loadTaskProjectOptions: api.projects }));
vi.mock("./TaskComposer", () => ({ TaskComposer: ({initialDescription}: {initialDescription: string}) => <div role="dialog" aria-label="Создание задачи">{initialDescription}</div> }));
vi.mock("./MailComposer", () => ({ MailComposer: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="Редактор письма"><button onClick={onClose}>Закрыть редактор</button></div>, mailStateLabels: {} }));
vi.mock("./mail-preview", () => ({ MailAttachmentViewer: () => null, mailFilePreviewable: () => false }));
const connection: MailConnection = { accountId: "own-account", email: "owner@gmail.com", configured: true,
  sendingEnabled: false, connectedAt: "2026-10-20T12:00:00Z", reconnectRequired: false };
const message: MailMessage = { id: "message-1", threadId: "thread-1", subject: "Бюджет проекта", sender: "donor@example.com",
  recipients: "owner@gmail.com", receivedAt: "2026-10-20T12:00:00Z", snippet: "Только выбранное письмо", unread: true,
  body: '<img src="https://tracking.example/pixel">Приватный текст', messageId: "<one@example.com>", references: "", replyTo: "",
  attachments: [{ id: "file-1", fileName: "budget.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 100 }] };
function show(canEdit = true) {
  return render(<FluentProvider theme={webLightTheme}><MailView token="test-token" currentUserId="owner" people={[]} departments={[]} tasks={[]}
    canCreate={canEdit} canEdit={canEdit} canCreateTask canUseSigned onTaskCreated={vi.fn()} /></FluentProvider>);
}
beforeEach(() => {
  mockVisibleWindowLayout();
  vi.clearAllMocks(); api.connection.mockResolvedValue(connection); api.messages.mockResolvedValue({ messages: [message], nextPageToken: null });
  api.thread.mockResolvedValue({ messages: [message], truncated: false }); api.drafts.mockResolvedValue([]); api.projects.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  const tabster = getTabster(window);
  if (tabster) disposeTabster(tabster, true);
  vi.restoreAllMocks();
});
it("explains missing server setup without pretending the employee is connected", async () => {
  api.connection.mockResolvedValue({ ...connection, configured: false, accountId: null, email: null }); show();
  expect(await screen.findByText(/Почта ещё не настроена/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Подключить Gmail" })).toBeDisabled();
  expect(api.messages).not.toHaveBeenCalled();
});

it("keeps message rows unchanged while typing and refreshes only after search submission", async () => {
  const received = vi.fn(() => message.receivedAt);
  const item = { ...message, get receivedAt() { return received(); } };
  api.messages.mockResolvedValue({ messages: [item], nextPageToken: null });
  show(); await screen.findByRole("button", { name: /donor@example.com.*Бюджет проекта/ });
  const reads = received.mock.calls.length;
  const search = screen.getByRole("textbox", { name: "Поиск писем" });
  fireEvent.change(search, { target: { value: "Бюджет" } });
  expect(received).toHaveBeenCalledTimes(reads);
  expect(api.messages).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Найти" }));
  await waitFor(() => expect(api.messages).toHaveBeenCalledTimes(2));
  expect(api.messages.mock.calls[1]?.slice(0, 4)).toEqual(["test-token", "inbox", "Бюджет", ""]);
});

it("pauses list reads for the composer and refreshes once when it closes", async () => {
  show(); await screen.findByRole("button", { name: /donor@example.com.*Бюджет проекта/ });
  fireEvent.click(screen.getByRole("button", { name: "Написать письмо" }));
  await screen.findByRole("dialog", { name: "Редактор письма" });
  fireEvent(window, new Event("focus"));
  expect(api.messages).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть редактор" }));
  await waitFor(() => expect(api.messages).toHaveBeenCalledTimes(2));
});

it("keeps account management unavailable without edit permission", async () => {
  show(false); await screen.findByRole("button", { name: /donor@example.com.*Бюджет проекта/ });
  expect(screen.queryByRole("button", { name: "Управление Gmail" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Написать письмо" })).not.toBeInTheDocument();
});

it("coalesces focus reads, aborts the previous folder and ignores its late response", async () => {
  let complete!: (page: { messages: readonly MailMessage[]; nextPageToken: null }) => void;
  api.messages.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  show(); await waitFor(() => expect(api.messages).toHaveBeenCalledOnce());
  const signal = api.messages.mock.calls[0]?.[4] as AbortSignal;
  fireEvent(window, new Event("focus")); fireEvent(window, new Event("focus"));
  expect(api.messages).toHaveBeenCalledOnce();
  api.messages.mockResolvedValue({ messages: [], nextPageToken: null });
  fireEvent.click(screen.getByRole("button", { name: "Избранное" }));
  await waitFor(() => expect(api.messages).toHaveBeenCalledTimes(2));
  expect(signal.aborted).toBe(true);
  await act(async () => complete({ messages: [message], nextPageToken: null }));
  expect(screen.queryByRole("button", { name: /donor@example.com.*Бюджет проекта/ })).not.toBeInTheDocument();
});
it.each([1, 2, 3])("renders inert mail and asks which content to share before composing a task (session %i)", async () => {
  show(); fireEvent.click(await screen.findByRole("button", { name: /donor@example.com.*Бюджет проекта/ }));
  expect(await screen.findByText(message.body)).toBeInTheDocument();
  expect(document.querySelector('img[src*="tracking.example"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Создать задачу" }));
  const selection = await screen.findByRole("dialog", { name: "Что передать в задачу" });
  await waitFor(() => expect(within(selection).getByRole("checkbox", { name: "Включить текст выбранного письма" })).toHaveFocus());
  expect(within(selection).getByRole("checkbox", { name: "budget.xlsx" })).not.toBeChecked();
  fireEvent.click(within(selection).getByRole("checkbox", { name: "Включить текст выбранного письма" }));
  fireEvent.click(within(selection).getByRole("button", { name: "Перейти к созданию задачи" }));
  const composer = await screen.findByRole("dialog", { name: "Создание задачи" });
  expect(composer).toHaveTextContent("Бюджет проекта"); expect(composer).not.toHaveTextContent("Приватный текст");
});
