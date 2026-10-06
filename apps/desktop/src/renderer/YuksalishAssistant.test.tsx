import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";

import { YuksalishAssistant } from "./YuksalishAssistant";
import { workspaceTheme } from "./workspace-theme";
import { clearAssistantChat, createAssistantChat, listAssistantChats, loadAssistantMessages, sendAssistantMessage, transcribeAssistantVoice } from "./workspace-api";

vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({ state }: { state: string }) => <span data-testid={`thinking-${state}`} />,
}));

vi.mock("./workspace-api", () => ({
  clearAssistantChat: vi.fn(), createAssistantChat: vi.fn(), listAssistantChats: vi.fn(),
  loadAssistantMessages: vi.fn(),
  sendAssistantMessage: vi.fn(),
  transcribeAssistantVoice: vi.fn(),
}));

describe("YuksalishAssistant", () => {
  it("opens the agreed form on an explicit chat signal without a model call or saving", async () => {
    const action = { kind: "task", ready: true, fields: { title: "Отчёт", assignee: "я" } } as const;
    vi.mocked(loadAssistantMessages).mockResolvedValue([{ id: "ready-form", role: "assistant", model: "flash-lite",
      content: "Черновик готов", createdAt: "2030-01-01T00:00:00Z", actionDraft: action }]);
    const prepare = vi.fn(async () => undefined);
    render(<FluentProvider theme={workspaceTheme}><YuksalishAssistant token="test" onPrepareAction={prepare} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Черновик готов", { selector: ".assistant-reply p" });
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), { target: { value: "Да, открывай форму" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith(action));
    expect(sendAssistantMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ассистент Yuksalish" })).not.toBeInTheDocument());
  });
  it("keeps an agreed draft and the signal when opening a form fails", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{ id: "failed-form", role: "assistant", model: "flash-lite",
      content: "Можно открыть форму", createdAt: "2030-01-01T00:00:00Z",
      actionDraft: { kind: "task", ready: true, fields: { title: "Отчёт", assignee: "Неизвестный" } } }]);
    const prepare = vi.fn(async () => { throw new Error("Уточните исполнителя"); });
    render(<FluentProvider theme={workspaceTheme}><YuksalishAssistant token="test" onPrepareAction={prepare} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Можно открыть форму");
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), { target: { value: "Открывай форму" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await screen.findByText("Уточните исполнителя");
    expect(screen.getByRole("textbox", { name: "Сообщение ассистенту" })).toHaveValue("Открывай форму");
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.mocked(listAssistantChats).mockResolvedValue([{ id: "first", title: "Первый чат", isDefault: true,
      createdAt: "2026-10-04T09:00:00Z", updatedAt: "2026-10-04T09:00:00Z" }]);
    vi.mocked(createAssistantChat).mockReset();
    vi.mocked(clearAssistantChat).mockReset();
    vi.mocked(loadAssistantMessages).mockReset().mockResolvedValue([]);
    vi.mocked(sendAssistantMessage).mockReset();
  });

  it("creates a separate chat and reopens saved history with its unsent draft", async () => {
    const oldMessage = { id: "saved", role: "assistant" as const, model: "flash-lite" as const,
      content: "Сохранённая переписка", createdAt: "2026-10-04T09:00:00Z" };
    vi.mocked(loadAssistantMessages).mockResolvedValue([oldMessage]);
    vi.mocked(createAssistantChat).mockResolvedValue({ id: "second", title: "Новый чат", isDefault: false,
      createdAt: "2026-10-04T10:00:00Z", updatedAt: "2026-10-04T10:00:00Z" });
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Сохранённая переписка");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Несохранённый текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Новый чат" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Чат ассистента" })).toHaveTextContent("Новый чат"));
    expect(screen.queryByText("Сохранённая переписка")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(createAssistantChat).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("combobox", { name: "Чат ассистента" }));
    fireEvent.click(screen.getByRole("option", { name: "Первый чат" }));
    await screen.findByText("Сохранённая переписка");
    expect(screen.getByRole("textbox")).toHaveValue("Несохранённый текст");
    expect(loadAssistantMessages).toHaveBeenLastCalledWith("test-token", "first");
  });

  it("keeps history and draft when switching or creating a chat fails", async () => {
    vi.mocked(listAssistantChats).mockResolvedValue(["first", "second"].map((id) => ({ id,
      title: id, isDefault: id === "first", createdAt: "2026-10-04", updatedAt: "2026-10-04" })));
    vi.mocked(loadAssistantMessages).mockResolvedValueOnce([{ id: "saved", role: "assistant", model: "flash-lite",
      content: "Прежняя переписка", createdAt: "2026-10-04T09:00:00Z" }]).mockRejectedValue(new Error("Сбой загрузки"));
    vi.mocked(createAssistantChat).mockRejectedValue(new Error("Сбой создания"));
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Прежняя переписка");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Мой текст" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Чат ассистента" }));
    fireEvent.click(screen.getByRole("option", { name: "second" }));
    await screen.findByText("Сбой загрузки");
    expect(screen.getByRole("combobox", { name: "Чат ассистента" })).toHaveTextContent("first");
    expect(screen.getByRole("textbox")).toHaveValue("Мой текст");
    expect(screen.getByText("Прежняя переписка")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новый чат" }));
    await screen.findByText("Сбой создания");
    expect(screen.getByRole("textbox")).toHaveValue("Мой текст");
  });

  it("sends to the selected new chat and blocks switching until its answer arrives", async () => {
    vi.mocked(createAssistantChat).mockResolvedValue({ id: "second", title: "Новый чат", isDefault: false,
      createdAt: "2026-10-04T10:00:00Z", updatedAt: "2026-10-04T10:00:00Z" });
    let resolveAnswer!: (value: Awaited<ReturnType<typeof sendAssistantMessage>>) => void;
    vi.mocked(sendAssistantMessage).mockImplementation(() => new Promise((resolve) => { resolveAnswer = resolve; }));
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    fireEvent.click(screen.getByRole("button", { name: "Новый чат" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Чат ассистента" })).toHaveTextContent("Новый чат"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Другой разговор" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith("test-token", "flash-lite", "Другой разговор", undefined, false, "second"));
    expect(screen.getByRole("combobox", { name: "Чат ассистента" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Новый чат" })).toBeDisabled();
    resolveAnswer({ id: "answer", role: "assistant", model: "flash-lite", content: "Новый ответ", createdAt: "2026-10-04T10:01:00Z" });
    await screen.findByText("Новый ответ");
    expect(screen.getByRole("combobox", { name: "Чат ассистента" })).toBeEnabled();
  });

  it("switches sidebar chats in the expanded window without losing unsent text", async () => {
    vi.mocked(listAssistantChats).mockResolvedValue(["first", "second"].map((id) => ({ id,
      title: id, isDefault: id === "first", createdAt: "2026-10-04", updatedAt: "2026-10-04" })));
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Черновик первого чата" } });
    fireEvent.click(screen.getByRole("button", { name: "Развернуть окно" }));
    const sidebar = screen.getByRole("navigation", { name: "Список чатов ассистента" });
    fireEvent.click(within(sidebar).getByRole("button", { name: /second/ }));
    await waitFor(() => expect(within(sidebar).getByRole("button", { name: /second/ })).toHaveAttribute("aria-current", "true"));
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.click(within(sidebar).getByRole("button", { name: /first/ }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Черновик первого чата"));
    expect(loadAssistantMessages).toHaveBeenLastCalledWith("test-token", "first");
  });

  it("supports keyboard chat selection and dismisses the picker without closing the assistant", async () => {
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const picker = screen.getByRole("combobox", { name: "Чат ассистента" });
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    const option = await screen.findByRole("option", { name: "Первый чат" });
    await waitFor(() => expect(option).toHaveFocus());
    fireEvent.keyDown(option, { key: "Escape" });
    await waitFor(() => expect(picker).toHaveAttribute("aria-expanded", "false"));
    expect(picker).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Ассистент Yuksalish" })).toBeInTheDocument();
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "Первый чат" }));
    expect(picker).toHaveAttribute("aria-expanded", "false");
    expect(loadAssistantMessages).toHaveBeenCalledTimes(1);
  });

  it("dismisses quick actions with Escape and restores focus without closing the assistant", async () => {
    render(<FluentProvider theme={workspaceTheme}><YuksalishAssistant token="test-token" /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const toggle = screen.getByRole("button", { name: "Быстрые действия" });
    fireEvent.click(toggle);
    const actions = await screen.findByRole("group", { name: "Быстрые действия" });
    expect(within(actions).getAllByRole("button")).toHaveLength(8);
    fireEvent.keyDown(within(actions).getByRole("button", { name: "Мои дела" }), { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Ассистент Yuksalish" })).toBeInTheDocument();
    expect(screen.getByText("ИИ может допускать ошибки, перепроверяйте ответы")).toBeInTheDocument();
  });

  it("confirms clearing only the current chat and keeps its content on failure", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{ id: "saved", role: "assistant", model: "flash-lite",
      content: "Переписка для очистки", createdAt: "2026-10-04T09:00:00Z" }]);
    let rejectClear!: (reason: Error) => void;
    vi.mocked(clearAssistantChat).mockImplementationOnce(() => new Promise<void>((_, reject) => {
      rejectClear = reject;
    })).mockResolvedValue(undefined);
    // Match App's provider boundary for Fluent's portal, focus and motion lifecycle.
    render(<FluentProvider theme={workspaceTheme}><YuksalishAssistant token="test-token" /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Переписка для очистки");
    fireEvent.click(screen.getByRole("button", { name: "Очистить текущий чат" }));
    const firstConfirmation = await screen.findByRole("dialog", { name: "Очистить текущий чат?" });
    const cancelButton = within(firstConfirmation).getByRole("button", { name: "Отмена", hidden: true });
    // Model the focus of a real pointer click before asserting Tabster's modal state.
    act(() => cancelButton.focus());
    await waitFor(() => expect(firstConfirmation).not.toHaveAttribute("aria-hidden", "true"));
    fireEvent.click(within(firstConfirmation).getByRole("button", { name: "Отмена" }));
    expect(clearAssistantChat).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Очистить текущий чат?" })).not.toBeInTheDocument());
    // Wait for Fluent's exit presence, not only its hidden accessibility state.
    await waitFor(() => expect(document.querySelector(".confirm-action-dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Очистить текущий чат" }));
    const confirmation = await screen.findByRole("dialog", { name: "Очистить текущий чат?" });
    const confirmButton = confirmation.querySelector<HTMLButtonElement>(".confirm-action-danger")!;
    // fireEvent.click alone does not focus like a browser's pointer click. Keep
    // Tabster's active modal on the confirmation, including the pending/error phase.
    act(() => confirmButton.focus());
    await waitFor(() => expect(confirmation).not.toHaveAttribute("aria-hidden", "true"));
    expect(document.activeElement).toBe(confirmButton);
    fireEvent.click(confirmButton);
    expect(confirmation).toBeInTheDocument();
    expect(confirmation).toHaveAccessibleName("Очистить текущий чат?");
    expect(confirmation).not.toHaveAttribute("aria-hidden", "true");
    expect(within(confirmation).getByRole("button", { name: "Очищаем…" })).toBeDisabled();
    expect(within(confirmation).getByRole("button", { name: "Отмена" })).toBeDisabled();
    expect(confirmation).toHaveAttribute("aria-busy", "true");
    await act(async () => rejectClear(new Error("Сбой очистки")));
    expect(within(confirmation).getByText("Сбой очистки")).toBeInTheDocument();
    expect(confirmation).toHaveAttribute("aria-busy", "false");
    expect(clearAssistantChat).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Переписка для очистки")).toBeInTheDocument();
    const retryButton = await within(confirmation).findByRole("button", { name: "Очистить чат" });
    await waitFor(() => expect(retryButton).toBeEnabled());
    fireEvent.click(retryButton);
    await waitFor(() => expect(screen.queryByText("Переписка для очистки")).not.toBeInTheDocument());
    expect(clearAssistantChat).toHaveBeenLastCalledWith("test-token", "first");
    expect(screen.getByRole("combobox", { name: "Чат ассистента" })).toHaveTextContent("Первый чат");
  });

  it("accepts the 50 MB boundary without sending automatically", async () => {
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const file = new File(["%PDF-1.7"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 50_000_000 });
    fireEvent.change(screen.getByLabelText("Выбрать вложение"), { target: { files: [file] } });
    expect(screen.getByText("large.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });

  it("keeps its header slot, toggles the dialog and restores focus without losing the draft", async () => {
    render(<header className="global-bar"><div className="workspace-top-context">
      <YuksalishAssistant token="test-token" />
      <button type="button">Профиль</button>
    </div></header>);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(launcher);
    await screen.findByText("С чего начнём?");
    expect(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" })).toBe(launcher);
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), {
      target: { value: "Мой черновик" },
    });
    fireEvent.click(launcher);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(launcher).toHaveFocus());
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(launcher);
    expect(screen.getByRole("textbox", { name: "Сообщение ассистенту" })).toHaveValue("Мой черновик");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(launcher).toHaveFocus());
  });

  it("opens globally, switches model and keeps a real answer in the stream", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      id: "reply-1", role: "assistant", model: "pro",
      content: "Ваши задачи проверены.", createdAt: "2026-09-28T10:00:00Z",
    });
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    expect(document.querySelector(".assistant-empty .assistant-empty-orb.gradient-orb-fallback")).toBeInTheDocument();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Режим" }).value).toBe("flash-lite");
    expect(screen.getByRole("option", { name: "Лёгкий" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Рабочий" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Фокус" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Режим"), { target: { value: "pro" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), {
      target: { value: "Какие у меня задачи?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(document.querySelector(".assistant-message.is-assistant"))
      .toHaveTextContent("Ваши задачи проверены."));
    expect(sendAssistantMessage).toHaveBeenCalledWith("test-token", "pro", "Какие у меня задачи?", undefined, false, "first");
    expect(screen.queryByText(/Gemini/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть окно" }));
    expect(screen.getByRole("button", { name: "Свернуть окно" })).toBeInTheDocument();
  });
  it("keeps the launcher mounted but unavailable under another dialog", async () => {
    render(<YuksalishAssistant token="test-token" />);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    try {
      act(() => document.body.append(dialog));
      await waitFor(() => expect(launcher).toBeDisabled());
      expect(document.querySelector(".assistant-launcher")).toBe(launcher);
      fireEvent.click(launcher);
      expect(launcher).toHaveAttribute("aria-expanded", "false");
      act(() => dialog.remove());
      await waitFor(() => expect(launcher).toBeEnabled());
      fireEvent.click(launcher);
      await screen.findByRole("dialog", { name: "Ассистент Yuksalish" });
    } finally { dialog.remove(); }
  });
  it("does not steal focus from a dialog opened while the assistant is closing", async () => {
    render(<YuksalishAssistant token="test-token" />);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    fireEvent.click(launcher);
    await screen.findByText("С чего начнём?");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть ассистента" }));
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    const control = document.createElement("button");
    dialog.append(control);
    try {
      act(() => { document.body.append(dialog); control.focus(); });
      await waitFor(() => expect(document.querySelector(".assistant-panel")).toBeNull());
      expect(control).toHaveFocus();
      expect(launcher).toBeDisabled();
    } finally { act(() => dialog.remove()); }
  });

  it("preserves the draft when the server rejects the request", async () => {
    vi.mocked(sendAssistantMessage).mockRejectedValue(new Error("Ассистент пока не настроен"));
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" });
    fireEvent.change(input, { target: { value: "Проверь задачу" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(input.value).toBe("Проверь задачу"));
    expect(document.querySelector(".assistant-message")).not.toBeInTheDocument();
  });

  it("lets a user reply to an earlier assistant message from its context menu", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "older", role: "assistant", model: "flash-lite", content: "Первый совет.",
      createdAt: "2026-09-28T09:00:00Z",
    }]);
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      id: "answer", role: "assistant", model: "flash-lite", content: "Уточнение.",
      createdAt: "2026-09-28T09:01:00Z",
    });
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    const earlier = (await screen.findByText("Первый совет.")).closest("article")!;
    fireEvent.contextMenu(earlier, { clientX: 120, clientY: 120 });
    expect(screen.getByRole("menuitem", { name: "Ответить" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ответить" }));
    expect(screen.getByText("Ответ на сообщение Yuksalish")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), {
      target: { value: "А второй шаг?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(
      "test-token", "flash-lite", "↳ Ответ на сообщение ассистента: Первый совет.\n\nА второй шаг?",
      undefined, false, "first",
    ));
    await waitFor(() => expect(screen.queryByText("Ответ на сообщение Yuksalish")).not.toBeInTheDocument());
  });

  it("moves the sent text into the stream before the answer arrives", async () => {
    let resolveAnswer!: (value: Awaited<ReturnType<typeof sendAssistantMessage>>) => void;
    vi.mocked(sendAssistantMessage).mockImplementation(() => new Promise((resolve) => {
      resolveAnswer = resolve;
    }));
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" });
    fireEvent.change(input, { target: { value: "Что нового?" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    expect(input.value).toBe("");
    expect(screen.getByText("Что нового?")).toBeInTheDocument();
    expect(screen.getByTestId("thinking-composing")).toBeInTheDocument();
    resolveAnswer({ id: "reply-2", role: "assistant", model: "flash",
      content: "Есть обновления.", createdAt: "2026-09-28T10:00:00Z" });
    await waitFor(() => expect(document.querySelector(".assistant-message.is-assistant"))
      .toHaveTextContent("Есть обновления."));
  });

  it("grows the draft field up to a fixed limit and restores focus after closing", async () => {
    render(<YuksalishAssistant token="test-token" />);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    fireEvent.click(launcher);
    await screen.findByText("С чего начнём?");
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" });
    Object.defineProperty(input, "scrollHeight", { configurable: true, get: () => 230 });
    fireEvent.change(input, { target: { value: "Длинный текст\nс новой строкой" } });
    expect(input.style.height).toBe("180px");
    expect(input.style.overflowY).toBe("auto");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть ассистента" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }))
      .toHaveFocus());
  });

  it("attaches a bounded PDF and keeps its name visible in the conversation", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      id: "file-answer", role: "assistant", model: "flash-lite",
      content: "Это письмо.", createdAt: "2026-09-28T10:00:00Z",
    });
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const input = screen.getByLabelText("Выбрать вложение") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["%PDF-1.7\ntext"], "letter.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("letter.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(
      "test-token", "flash-lite", "Расскажи, что находится во вложении.",
      expect.objectContaining({ name: "letter.pdf", mime_type: "application/pdf" }),
      false, "first",
    ));
    expect(document.querySelector(".assistant-message.is-user")).toHaveTextContent("letter.pdf");
  });

  it("pastes a file into the focused editor without sending or replacing text", async () => {
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const editor = screen.getByRole("textbox", { name: "Сообщение ассистенту" });
    fireEvent.change(editor, { target: { value: "Разбери документ" } });
    fireEvent.paste(editor, { clipboardData: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] } });
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(editor).toHaveValue("Разбери документ");
    expect(editor).toHaveFocus();
    expect(sendAssistantMessage).not.toHaveBeenCalled();
    const normalPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(normalPaste, "clipboardData", { value: { files: [] } });
    fireEvent(editor, normalPaste);
    expect(normalPaste.defaultPrevented).toBe(false);
  });

  it("accepts drops on the header and stream in both sizes, not only on the editor", async () => {
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const dataTransfer = { types: ["Files"], files: [new File(["report"], "drop.txt")], dropEffect: "none" };
    const header = document.querySelector(".assistant-header")!;
    fireEvent.dragEnter(header, { dataTransfer });
    expect(screen.getByText("Отпустите файл здесь")).toBeInTheDocument();
    fireEvent.dragOver(header, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    fireEvent.drop(header, { dataTransfer });
    expect(screen.getByText("drop.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть окно" }));
    fireEvent.drop(document.querySelector(".assistant-stream")!, { dataTransfer: {
      ...dataTransfer, files: [new File(["new"], "expanded.txt")],
    } });
    expect(screen.getByText("expanded.txt")).toBeInTheDocument();
    expect(screen.queryByText("drop.txt")).not.toBeInTheDocument();
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });

  it("rejects multiple, oversized and unsupported dropped files without losing the valid attachment", async () => {
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const panel = screen.getByRole("dialog", { name: "Ассистент Yuksalish" });
    const drop = (files: File[]) => fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files } });
    const valid = new File(["text"], "keep.txt");
    drop([valid]);
    drop([valid, new File(["text"], "second.txt")]);
    expect(screen.getByRole("alert")).toHaveTextContent("по одному файлу");
    drop([new File(["code"], "unsafe.exe")]);
    expect(screen.getByRole("alert")).toHaveTextContent("DOCX");
    const oversized = new File(["large"], "large.pdf");
    Object.defineProperty(oversized, "size", { value: 50_000_001 });
    drop([oversized]);
    expect(screen.getByRole("alert")).toHaveTextContent("до 50 МБ");
    drop([new File([], "empty.txt")]);
    expect(screen.getByRole("alert")).toHaveTextContent("непустой");
    expect(screen.getByText("keep.txt")).toBeInTheDocument();
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });

  it("restores a pasted attachment and text after a failed send", async () => {
    vi.mocked(sendAssistantMessage).mockRejectedValue(new Error("Временная ошибка"));
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const editor = screen.getByRole("textbox", { name: "Сообщение ассистенту" });
    fireEvent.change(editor, { target: { value: "Проверь текст" } });
    fireEvent.paste(editor, { clipboardData: { files: [new File(["text"], "retry.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Временная ошибка");
    expect(editor).toHaveValue("Проверь текст");
    expect(screen.getByText("retry.txt")).toBeInTheDocument();
  });

  it("fills all primary workflows without automatically sending a request", async () => {
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    for (const [label, text] of [
      [/Создать задачу/, "Создай задачу: "], [/Начать проект/, "Создай проект: "],
      [/Спланировать поездку/, "Подготовь командировку: "], [/Оформить отсутствие/, "Подготовь заявку на отсутствие: "],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("textbox", { name: "Сообщение ассистенту" })).toHaveValue(text);
    }
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });

  it("stops resize motion when reduced motion or forced colors changes while open", async () => {
    class Preference extends EventTarget { matches = false; }
    const reduced = new Preference(), forced = new Preference(), other = new Preference();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => query.includes("reduced-motion")
      ? reduced : query.includes("forced-colors") ? forced : other));
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
    screen.getByRole("dialog", { name: "Ассистент Yuksalish" }).animate = animate;
    fireEvent.click(screen.getByRole("button", { name: "Развернуть окно" }));
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => { reduced.matches = true; reduced.dispatchEvent(new Event("change")); });
    expect(cancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Свернуть окно" }));
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => { forced.matches = true; reduced.matches = false; forced.dispatchEvent(new Event("change")); });
    fireEvent.click(screen.getByRole("button", { name: "Развернуть окно" }));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("does not treat a general question after a ready draft as a draft edit", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "ready", role: "assistant", model: "flash-lite", content: "Готово к проверке.",
      createdAt: "2026-09-28T10:00:00Z", actionDraft: { kind: "task", ready: true, fields: { title: "Отчёт" } },
    }]);
    vi.mocked(sendAssistantMessage).mockResolvedValue({ id: "general", role: "assistant", model: "flash-lite", content: "Четыре.", createdAt: "2026-09-28T10:01:00Z" });
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Готово к проверке.");
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), { target: { value: "Сколько будет 2 + 2?" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith("test-token", "flash-lite", "Сколько будет 2 + 2?", undefined, false, "first"));
  });

  it.each(["", "Расшифруй эту запись"])("sends audio with the accompanying text %j, never a composer transcription", async (instruction) => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    class TestRecorder {
      static isTypeSupported() { return true; }
      state: "inactive" | "recording" = "inactive";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      constructor(readonly stream: MediaStream) {}
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", TestRecorder);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      id: "voice-action", role: "assistant", model: "flash-lite", content: "Черновик готов.",
      createdAt: "2026-09-28T10:00:00Z", actionDraft: {
        kind: "task", ready: true, fields: { title: "Проверить отчёт" },
      },
    });
    try {
      render(<YuksalishAssistant token="test-token" onPrepareAction={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
      await screen.findByText("С чего начнём?");
      const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" });
      fireEvent.change(input, { target: { value: instruction } });
      fireEvent.click(screen.getByRole("button", { name: "Голосовой ввод" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Слушаю");
      fireEvent.click(screen.getByRole("button", { name: "Остановить запись" }));
      await screen.findByText("Голосовое сообщение.webm");
      expect(input.value).toBe(instruction);
      expect(transcribeAssistantVoice).not.toHaveBeenCalled();
      expect(sendAssistantMessage).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
      await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(
        "test-token", "flash-lite", instruction, {
          name: "Голосовое сообщение.webm", mime_type: "audio/webm",
          data_base64: "dm9pY2U=", as_prompt: !instruction,
        }, false, "first",
      ));
      expect(stopTrack).toHaveBeenCalled();
    } finally {
      if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("restores the unsent audio preview after closing and reopening the assistant", async () => {
    const createUrl = vi.fn(() => "blob:voice-preview");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL = createUrl;
      static override revokeObjectURL = revokeUrl;
    });
    render(<YuksalishAssistant token="test-token" />);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    fireEvent.click(launcher);
    await screen.findByText("С чего начнём?");
    fireEvent.change(screen.getByLabelText("Выбрать вложение"), { target: {
      files: [new File(["voice"], "voice.webm", { type: "audio/webm" })],
    } });
    expect(screen.getByLabelText("Прослушать голосовое сообщение")).toHaveAttribute("src", "blob:voice-preview");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть ассистента" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ассистент Yuksalish" })).not.toBeInTheDocument());
    expect(revokeUrl).toHaveBeenCalledWith("blob:voice-preview");
    fireEvent.click(launcher);
    expect(await screen.findByText("voice.webm")).toBeInTheDocument();
    expect(screen.getByLabelText("Прослушать голосовое сообщение")).toHaveAttribute("src", "blob:voice-preview");
    expect(createUrl).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Убрать вложение" }));
    expect(revokeUrl).toHaveBeenCalledTimes(2);
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });

  it("keeps audio and text after a failure and prevents duplicate voice sends", async () => {
    vi.mocked(sendAssistantMessage).mockRejectedValueOnce(new Error("Повторите позже"))
      .mockResolvedValueOnce({ id: "voice-retry", role: "assistant", model: "flash-lite",
        content: "Результат анализа", createdAt: "2030-01-01T00:00:00Z" });
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
    const input = screen.getByRole("textbox", { name: "Сообщение ассистенту" });
    fireEvent.change(input, { target: { value: "Проанализируй запись" } });
    fireEvent.change(screen.getByLabelText("Выбрать вложение"), { target: {
      files: [new File(["voice"], "voice.webm", { type: "audio/webm" })],
    } });
    expect(screen.getByRole("button", { name: "Голосовой ввод" })).toBeDisabled();
    const send = screen.getByRole("button", { name: "Отправить сообщение" });
    fireEvent.click(send); fireEvent.click(send);
    await screen.findByText("Повторите позже");
    expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("Проанализируй запись");
    expect(screen.getByText("voice.webm")).toBeInTheDocument();
    fireEvent.click(send);
    await screen.findByText("Результат анализа");
    expect(sendAssistantMessage).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Убрать вложение" })).not.toBeInTheDocument();
  });

  it("opens an agreed form on a spoken signal but not on audio accompanied by text", async () => {
    const action = { kind: "task", ready: true, fields: { title: "Отчёт", assignee: "я" } } as const;
    vi.mocked(loadAssistantMessages).mockResolvedValue([{ id: "voice-ready", role: "assistant", model: "flash-lite",
      content: "Согласованный черновик", createdAt: "2030-01-01T00:00:00Z", actionDraft: action }]);
    vi.mocked(sendAssistantMessage).mockResolvedValueOnce({ id: "voice-data", role: "assistant", model: "flash-lite",
      content: "Расшифровка: Открывай форму", createdAt: "2030-01-01T00:00:00Z" })
      .mockResolvedValueOnce({ id: "voice-open", role: "assistant", model: "flash-lite",
        content: "Голосовой сигнал", voicePrompt: "Открывай форму", createdAt: "2030-01-01T00:00:00Z" });
    const prepare = vi.fn(async () => undefined);
    render(<YuksalishAssistant token="test-token" onPrepareAction={prepare} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Согласованный черновик");
    const attach = () => fireEvent.change(screen.getByLabelText("Выбрать вложение"), { target: {
      files: [new File(["voice"], "voice.webm", { type: "audio/webm" })],
    } });
    attach();
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), { target: { value: "Расшифруй запись" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await screen.findByText("Расшифровка: Открывай форму");
    expect(prepare).not.toHaveBeenCalled();
    // Return to the saved, ready answer; a voice command must never open an unsaved draft.
    fireEvent.click(screen.getByRole("button", { name: "Закрыть ассистента" }));
    cleanup();
    render(<YuksalishAssistant token="test-token" onPrepareAction={prepare} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Согласованный черновик");
    attach();
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith(action));
  });

  it("releases a late microphone stream after the assistant is closed", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    let resolveStream!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal("MediaRecorder", class { static isTypeSupported() { return true; } });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: () => new Promise<MediaStream>((resolve) => { resolveStream = resolve; }),
    } });
    try {
      render(<YuksalishAssistant token="test-token" />);
      fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
      await screen.findByText("С чего начнём?");
      fireEvent.click(screen.getByRole("button", { name: "Голосовой ввод" }));
      fireEvent.click(screen.getByRole("button", { name: "Закрыть ассистента" }));
      await act(async () => resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream));
      expect(stop).toHaveBeenCalledOnce();
      expect(sendAssistantMessage).not.toHaveBeenCalled();
      expect(transcribeAssistantVoice).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(navigator, "mediaDevices", original);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("keeps request templates available after the first conversation", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "older", role: "assistant", model: "flash-lite", content: "Здравствуйте.",
      createdAt: "2026-09-28T09:00:00Z",
    }]);
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Здравствуйте.");
    fireEvent.click(screen.getByRole("button", { name: /Быстрые действия/ }));
    fireEvent.click(screen.getByRole("button", { name: "О сотруднике" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" }).value)
      .toContain("[имя]");
  });

  it("removes the redundant answer preparation expander even from old history", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "sourced", role: "assistant", model: "flash-lite", content: "Сведения о сотруднике.",
      createdAt: "2026-09-28T09:00:00Z", sourceLabels: ["Проверены доступные профили сотрудников"],
    }]);
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Сведения о сотруднике.");
    expect(screen.queryByText("Как подготовлен ответ")).not.toBeInTheDocument();
    expect(screen.queryByText("Проверены доступные профили сотрудников")).not.toBeInTheDocument();
  });

  it("opens a server-provided record without closing the assistant", async () => {
    const onOpenReference = vi.fn();
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "answer-links", role: "assistant", model: "flash-lite", content: "Есть задача.",
      createdAt: "2026-09-28T09:00:00Z",
      references: [{ label: "Задача: Подготовить отчёт", section: "tasks", entityId: "task-1" }],
    }]);
    render(<YuksalishAssistant token="test-token" onOpenReference={onOpenReference} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    fireEvent.click(await screen.findByRole("button", { name: /Задача: Подготовить отчёт/ }));
    expect(onOpenReference).toHaveBeenCalledWith({
      label: "Задача: Подготовить отчёт", section: "tasks", entityId: "task-1",
    });
    expect(screen.getByRole("dialog", { name: "Ассистент Yuksalish" })).toBeInTheDocument();
  });

  it("keeps an agreed draft without opening a form until an explicit signal", async () => {
    const actionDraft = { kind: "task" as const, fields: { title: "Отчёт", assignee: "я" }, ready: true };
    const onPrepareAction = vi.fn();
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "prepared-agreement", role: "assistant", model: "flash-lite", content: "Черновик готов.",
      createdAt: "2026-09-28T09:00:00Z", actionDraft,
    }]);
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      id: "agreed", role: "assistant", model: "flash-lite", content: "Данные согласованы.",
      createdAt: "2026-09-28T09:01:00Z", actionDraft,
    });
    render(<YuksalishAssistant token="test-token" onPrepareAction={onPrepareAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByRole("button", { name: "Открыть заполненную форму" });
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), { target: { value: "Да, всё верно" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(
      "test-token", "flash-lite", "Да, всё верно", undefined, true, "first",
    ));
    await screen.findByText("Данные согласованы.");
    expect(screen.getByRole("button", { name: "Открыть заполненную форму" })).toBeEnabled();
    expect(onPrepareAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), { target: { value: "Открывай форму" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(onPrepareAction).toHaveBeenCalledExactlyOnceWith(actionDraft));
    expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it("continues an unsent action draft and opens its form only after a click", async () => {
    const onPrepareAction = vi.fn();
    const draft = { kind: "task" as const, fields: { title: "Проверить отчёт" }, ready: true };
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "prepared", role: "assistant", model: "flash-lite", content: "Черновик готов.",
      createdAt: "2026-09-28T09:00:00Z", actionDraft: draft,
    }]);
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      id: "updated", role: "assistant", model: "flash-lite", content: "Уточнил черновик.",
      createdAt: "2026-09-28T09:01:00Z", actionDraft: draft,
    });
    render(<YuksalishAssistant token="test-token" onPrepareAction={onPrepareAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    expect(await screen.findAllByRole("button", { name: "Открыть заполненную форму" })).toHaveLength(1);
    expect(onPrepareAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Уточнить черновик" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), {
      target: { value: "Добавь описание" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(
      "test-token", "flash-lite", "Добавь описание", undefined, true, "first",
    ));
    fireEvent.click((await screen.findAllByRole("button", { name: "Открыть заполненную форму" }))[0]!);
    expect(onPrepareAction).toHaveBeenCalledWith(draft);
    expect(screen.getByRole("dialog", { name: "Ассистент Yuksalish" })).toBeInTheDocument();
  });
});
