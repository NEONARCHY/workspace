import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { Dialog, DialogSurface, FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ChatMessage, ChatSummary } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatManagement, type ChatActions } from "./ChatManagement";
import { getMessageParticleTiming } from "./MessageVanishOverlay";
import { initialChats, initialMessages, initialTasks, people } from "./test-fixtures/demo-data";
import { EmbeddedConversation, MessengerView } from "./MessengerView";
import { rewriteMessengerDraft } from "./workspace-api";
import type * as WorkspaceApi from "./workspace-api";

vi.mock("./workspace-api", async (importOriginal) => ({
  ...await importOriginal<typeof WorkspaceApi>(),
  rewriteMessengerDraft: vi.fn(),
}));

function actions(): ChatActions {
  return {
    create: vi.fn(),
    setAvatar: vi.fn(),
    update: vi.fn(),
    add: vi.fn(),
    setMember: vi.fn(),
    remove: vi.fn(),
    transfer: vi.fn(),
    delete: vi.fn(),
  };
}
function renderMessenger(
  overrides: Partial<Parameters<typeof MessengerView>[0]> = {},
) {
  const props: Parameters<typeof MessengerView>[0] = {
    token: "access-token",
    currentUserId: "aziza",
    currentUserRole: "employee",
    chats: initialChats,
    messages: initialMessages,
    tasks: initialTasks,
    people,
    attachments: [],
    chatActions: actions(),
    onSendMessage: vi.fn(),
    onSendVoiceMessage: vi.fn(),
    onReactMessage: vi.fn(),
    onPinMessage: vi.fn(),
    onEditMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onCreateTaskFromMessage: vi.fn(),
    onDownloadAttachment: vi.fn(),
    onLoadAttachment: vi.fn(),
    onMarkRead: vi.fn(),
    ...overrides,
  };
  const view = render(
    <FluentProvider theme={webLightTheme}>
      <MessengerView {...props} />
    </FluentProvider>,
  );
  return { ...view, props };
}

function openMessageMenu(text: string) {
  const message = screen.getByText(text).closest(".message");
  if (!message) throw new Error(`Message not found: ${text}`);
  fireEvent.contextMenu(message);
}

function openChatMenu(chatId: string) {
  const row = document.querySelector(`[data-chat-id="${chatId}"] .chat-row`);
  if (!row) throw new Error(`Chat not found: ${chatId}`);
  fireEvent.contextMenu(row);
}

describe("Private messenger", () => {
  it("saves a shared icon only on confirmation and keeps a failed choice for retry", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.setAvatar!).mockRejectedValueOnce(new Error("Не удалось сохранить иконку"))
      .mockResolvedValue({ ...initialChats[0]!, avatarIconKey: "star" });
    renderMessenger({ chats: [{ ...initialChats[0]!, canEditAvatar: true }], chatActions });
    fireEvent.click(screen.getByRole("button", { name: "Изменить иконку чата" }));
    fireEvent.click(screen.getByRole("button", { name: "Иконка: Звезда" }));
    expect(chatActions.setAvatar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить иконку" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось сохранить иконку"));
    expect(screen.getByRole("button", { name: "Иконка: Звезда" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить иконку" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Сохранить иконку" })).not.toBeInTheDocument());
    expect(chatActions.setAvatar).toHaveBeenNthCalledWith(1, "finance", "star");
    expect(chatActions.setAvatar).toHaveBeenNthCalledWith(2, "finance", "star");
  });

  it("resets a managed trip icon to its semantic default and prevents unauthorized editing", async () => {
    const chatActions = actions();
    const tripChat = { ...initialChats[0]!, contextType: "trip", contextId: "trip-1", avatarIconKey: "star" as const, canEditAvatar: true };
    vi.mocked(chatActions.setAvatar!).mockResolvedValue({ ...tripChat, avatarIconKey: null });
    const view = renderMessenger({ chats: [tripChat], chatActions });
    fireEvent.click(screen.getByRole("button", { name: "Изменить иконку чата" }));
    fireEvent.click(screen.getByRole("button", { name: "По умолчанию" }));
    await waitFor(() => expect(chatActions.setAvatar).toHaveBeenCalledWith("finance", null));
    view.unmount();
    renderMessenger({ chats: [{ ...tripChat, canEditAvatar: false }], chatActions });
    expect(screen.queryByRole("button", { name: "Изменить иконку чата" })).not.toBeInTheDocument();
  });

  it("opens the current Projects module from its managed conversation", () => {
    const onOpenContext = vi.fn();
    renderMessenger({ chats: [{ ...initialChats[0]!, kind: "project", contextType: "project_hub", contextId: "hub-1" }], onOpenContext });
    fireEvent.click(screen.getByRole("button", { name: "Открыть проект" }));
    expect(onOpenContext).toHaveBeenCalledWith("project_hub", "hub-1");
  });
  it("reviews an assistant message before creating a direct chat, then keeps it unsent", async () => {
    const chatActions = actions();
    const newChat: ChatSummary = {
      ...initialChats[1]!, id: "dilshod-direct", title: people[2]!.name,
      members: [people[0]!, people[2]!].map((person) => ({
        userId: person.id, role: "member" as const,
        permissions: initialChats[1]!.permissions,
      })),
    };
    vi.mocked(chatActions.create).mockResolvedValue(newChat);
    const onSendMessage = vi.fn();
    renderMessenger({ chatActions, onSendMessage, assistantRecipientId: people[2]!.id,
      assistantDraft: { kind: "message", ready: true, fields: {
        recipient: people[2]!.name, body: "Пожалуйста, проверьте документ.",
      } },
    });
    expect(screen.getByRole("region", { name: "Подготовка сообщения" }))
      .toHaveTextContent("Пожалуйста, проверьте документ.");
    expect(chatActions.create).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Открыть диалог с черновиком" }));
    expect(await screen.findByRole("textbox", { name: "Новое сообщение" }))
      .toHaveValue("Пожалуйста, проверьте документ.");
    expect(chatActions.create).toHaveBeenCalledOnce();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("puts the assistant text in an existing chat draft without sending it", async () => {
    const onSendMessage = vi.fn();
    renderMessenger({
      focusChatId: initialChats[1]!.id,
      onSendMessage,
      assistantRecipientId: people[1]!.id,
      assistantDraft: { kind: "message", ready: true, fields: {
        recipient: people[1]!.name, body: "Проверьте письмо, пожалуйста.",
      } },
    });
    expect(await screen.findByRole("textbox", { name: "Новое сообщение" }))
      .toHaveValue("Проверьте письмо, пожалуйста.");
    expect(onSendMessage).not.toHaveBeenCalled();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("offers a rewrite without sending or replacing the draft before confirmation", async () => {
    vi.mocked(rewriteMessengerDraft).mockResolvedValue({ text: "Будьте добры, проверьте документ." });
    const onSendMessage = vi.fn();
    renderMessenger({ onSendMessage, canUseAssistant: true });
    const composer = screen.getByLabelText<HTMLInputElement>("Новое сообщение");
    fireEvent.change(composer, { target: { value: "Глянь документ" } });
    fireEvent.click(screen.getByRole("button", { name: "Переформулировать черновик с ИИ" }));
    fireEvent.click(screen.getByRole("button", { name: "Профессиональный" }));
    await screen.findByText("Будьте добры, проверьте документ.");
    expect(composer).toHaveValue("Глянь документ");
    expect(onSendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Заменить мой текст" }));
    expect(composer).toHaveValue("Будьте добры, проверьте документ.");
  });
  it("does not show or call AI rewrite without assistant access", () => {
    vi.mocked(rewriteMessengerDraft).mockClear();
    renderMessenger({ canUseAssistant: false });
    fireEvent.change(screen.getByLabelText("Новое сообщение"), { target: { value: "Текст" } });
    expect(screen.queryByRole("button", { name: "Переформулировать черновик с ИИ" })).not.toBeInTheDocument();
    expect(rewriteMessengerDraft).not.toHaveBeenCalled();
  });
  it("opens the message menu at the pointer in a viewport portal", () => {
    renderMessenger();
    const message = screen.getByText(initialMessages[0]!.body).closest(".message");
    expect(message).not.toBeNull();

    fireEvent.contextMenu(message!, { clientX: 420, clientY: 260 });

    const menu = screen.getByRole("menu");
    expect(menu).toHaveStyle({ left: "420px", top: "260px" });
    expect(document.querySelector(".conversation-pane")?.contains(menu)).toBe(false);
  });

  it("keeps right-click actions available without a visible hint", () => {
    renderMessenger();
    const message = screen.getByText(initialMessages[0]!.body).closest(".message");
    expect(message).not.toBeNull();

    fireEvent.focus(message!);

    expect(message!.querySelector('[title="Другие действия — правая кнопка мыши"]')).not.toBeInTheDocument();
  });

  it("keeps reaction and message menus above an embedded project or trip dialog", async () => {
    const chat = initialChats[0]!;
    const message: ChatMessage = {
      id: "embedded-reaction",
      chatId: chat.id,
      authorId: "baxtiyor",
      body: "Обсудим поездку",
      time: "14:20",
      reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: ["baxtiyor"] }],
    };
    const { props, rerender } = renderMessenger({ messages: [message] });
    rerender(<FluentProvider theme={webLightTheme}>
      <Dialog open><DialogSurface aria-label="Карточка поездки">
        <EmbeddedConversation {...props} chatId={chat.id} contextLabel="поездки" />
      </DialogSurface></Dialog>
    </FluentProvider>);

    const dialog = await screen.findByRole("dialog", { name: "Карточка поездки" });
    const messageBubble = within(dialog).getByText(message.body).closest(".message-body");
    expect(messageBubble?.querySelector(".message-actions")).not.toBeNull();
    expect(messageBubble?.nextElementSibling).toHaveClass("message-reactions");
    const reaction = within(dialog).getByRole("button", { name: /👍: Бахтиёр Самугов/ });
    fireEvent.contextMenu(reaction, { clientX: 80, clientY: 80 });
    const quick = screen.getByText(/Поставили реакцию/).closest(".message-context-menu");
    expect(quick?.parentElement?.parentElement).toBe(dialog.parentElement);
    expect(quick?.parentElement).toHaveClass("fui-FluentProvider");
    expect(quick?.querySelector(".message-reaction-people .fui-Avatar")).not.toBeNull();

    fireEvent.keyDown(quick!, { key: "Tab" });
    expect(screen.getByRole("dialog", { name: "Кто поставил реакцию" })).toBeInTheDocument();
    fireEvent.keyDown(quick!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Кто поставил реакцию" })).not.toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(reaction).toHaveFocus();

    fireEvent.pointerDown(document.body);
    fireEvent.contextMenu(within(dialog).getByText(message.body).closest(".message")!, { clientX: 90, clientY: 90 });
    expect(screen.getByRole("menu").parentElement?.parentElement).toBe(dialog.parentElement);
  });

  it("sends an executor's deadline request from the task chat and lets its author decide", async () => {
    const chat: ChatSummary = {
      ...initialChats.find((item) => item.id === "task-t-104")!,
      contextType: "task", contextId: "t-104",
    };
    const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString();
    const task = { ...initialTasks[0]!, dueAt, chatId: chat.id };
    const onRequestTaskDeadline = vi.fn().mockResolvedValue(task);
    const { props, rerender } = renderMessenger({
      chats: [chat], tasks: [task], messages: [], currentUserId: "dilshod",
      currentUserRole: "employee", onRequestTaskDeadline,
    });
    rerender(<FluentProvider theme={webLightTheme}>
      <EmbeddedConversation {...props} chatId={chat.id} />
    </FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Попросить перенос срока" }));
    const reasonBox = screen.getByRole("textbox", { name: "Причина переноса срока" });
    fireEvent.change(reasonBox, {
      target: { value: "Ожидаем материалы" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить запрос в чат" }));
    await waitFor(() => expect(onRequestTaskDeadline).toHaveBeenCalledOnce());
    expect(onRequestTaskDeadline.mock.calls[0]?.[0].id).toBe(task.id);
    expect(onRequestTaskDeadline.mock.calls[0]?.[2]).toBe("Ожидаем материалы");

    const message: ChatMessage = {
      id: "deadline-message", chatId: chat.id, authorId: "dilshod",
      body: "Прошу перенести срок задачи. Причина: Ожидаем материалы",
      systemKind: "task_deadline_request", time: "15:00",
      createdAt: new Date().toISOString(),
    };
    const authorTask = { ...task, deadlineRequests: [{
      id: "deadline-request", messageId: message.id, requesterUserId: "dilshod",
      oldDueAt: dueAt, proposedDueAt: new Date(Date.now() + 4 * 24 * 60 * 60_000).toISOString(),
      reason: "Ожидаем материалы", status: "pending" as const, createdAt: new Date().toISOString(),
    }] };
    const onDecideTaskDeadline = vi.fn().mockResolvedValue(authorTask);
    rerender(<FluentProvider theme={webLightTheme}>
      <EmbeddedConversation {...props} chatId={chat.id} tasks={[authorTask]} messages={[message]}
        currentUserId="baxtiyor" onDecideTaskDeadline={onDecideTaskDeadline} />
    </FluentProvider>);
    expect(screen.getByText("Перенос срока · ожидает решения")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить перенос" }));
    await waitFor(() => expect(onDecideTaskDeadline).toHaveBeenCalledWith(authorTask, "deadline-request", true));
  });

  it("opens the source object from a linked chat", () => {
    const onOpenContext = vi.fn();
    renderMessenger({
      chats: [{ ...initialChats[0]!, contextType: "project", contextId: "project-1" }],
      messages: [],
      onOpenContext,
    });
    fireEvent.click(screen.getByRole("button", { name: "Открыть проект" }));
    expect(onOpenContext).toHaveBeenCalledWith("project", "project-1");
  });

  it("offers a labelled calendar action in the chat header", () => {
    const onCreateCalendarEventFromChat = vi.fn();
    renderMessenger({ onCreateCalendarEventFromChat });

    fireEvent.click(screen.getByRole("button", { name: "Мероприятие" }));

    expect(onCreateCalendarEventFromChat).toHaveBeenCalledWith(initialChats[0]);
    expect(screen.getByRole("button", { name: "Создать мероприятие из чата" })).toBeVisible();
  });

  it("exposes chat deletion in the row menu and delays it for undo", async () => {
    vi.useFakeTimers();
    const chatActions = actions();
    vi.mocked(chatActions.delete).mockResolvedValue(undefined);
    renderMessenger({
      chats: [{ ...initialChats[0]!, canDelete: true }],
      chatActions,
    });

    openChatMenu("finance");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить группу" }));
    expect(screen.getByText("Чат будет удалён через 6 сек.")).toBeVisible();
    expect(chatActions.delete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(6_000);
    expect(chatActions.delete).toHaveBeenCalledWith("finance");
  });
  it("removes an encrypted chat draft after restoring it into the composer", async () => {
    const loadDraft = vi.fn().mockResolvedValue("Текст до обновления");
    const clearDraft = vi.fn().mockResolvedValue(undefined);
    const saveDraft = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("yuksalish", { loadDraft, clearDraft, saveDraft });
    renderMessenger();
    await waitFor(() => expect(screen.getByLabelText("Новое сообщение")).toHaveValue("Текст до обновления"));
    expect(loadDraft).toHaveBeenCalledWith("chat:aziza:finance");
    await waitFor(() => expect(clearDraft).toHaveBeenCalledWith("chat:aziza:finance"));
    expect(saveDraft).not.toHaveBeenCalled();
  });
  it("flushes the current message draft before a web update reload", async () => {
    const loadDraft = vi.fn().mockResolvedValue(null);
    const saveDraft = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("yuksalish", {
      loadDraft,
      clearDraft: vi.fn().mockResolvedValue(undefined),
      saveDraft,
    });
    renderMessenger();
    await waitFor(() => expect(loadDraft).toHaveBeenCalledWith("chat:aziza:finance"));
    fireEvent.change(screen.getByLabelText("Новое сообщение"), {
      target: { value: "Сохранить перед обновлением" },
    });
    window.dispatchEvent(new Event("yuksalish:prepare-web-update"));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith(
      "chat:aziza:finance",
      "Сохранить перед обновлением",
    ));
  });
  it("lets a regular employee create a private group with selected colleagues, even with no chats", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.create).mockResolvedValue({
      ...initialChats[0]!,
      id: "new",
      title: "Проектная команда",
    });
    renderMessenger({ chats: [], currentUserId: "dilshod", chatActions });
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Вы станете владельцем",
    );
    expect(screen.queryByRole("switch", { name: /предыдущую историю/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Внешние гости/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Название группы/ }), {
      target: { value: "Проектная команда" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Бахтиёр Самугов" }));
    expect(
      screen.queryByRole("button", { name: "Дилшод Рахимов" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Создать группу" }));
    await waitFor(() =>
      expect(chatActions.create).toHaveBeenCalledWith({
        kind: "group",
        title: "Проектная команда",
        description: "",
        memberIds: ["baxtiyor"],
        avatarIconKey: "team",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("appoints a group administrator with individual permissions and confirms ownership transfer", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.setMember).mockResolvedValue(initialChats[0]!);
    renderMessenger({ chatActions });
    fireEvent.click(screen.getByRole("button", { name: "Участники и права" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Права: Бахтиёр Самугов" }),
    );
    fireEvent.change(screen.getByLabelText("Роль в группе"), {
      target: { value: "moderator" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Прикреплять файлы" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить права" }));
    await waitFor(() =>
      expect(chatActions.setMember).toHaveBeenCalledWith("finance", {
        userId: "baxtiyor",
        role: "moderator",
        permissions: {
          sendMessages: true,
          uploadFiles: false,
          inviteMembers: true,
          manageMembers: true,
          editInfo: true,
          manageMessages: true,
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Роль в группе")).not.toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Права: Бахтиёр Самугов" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Передать владение группой" }),
    );
    expect(chatActions.transfer).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Вы станете администратором",
    );
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await waitFor(() =>
      expect(chatActions.transfer).toHaveBeenCalledWith("finance", "baxtiyor"),
    );
  });

  it("does not expose role assignment to ordinary members or workspace admins", () => {
    const member = initialChats[0]!.members.find(
      (item) => item.userId === "malika",
    )!;
    renderMessenger({
      currentUserId: "malika",
      chats: [{ ...initialChats[0]!, permissions: member.permissions }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Участники и права" }));
    expect(
      screen.queryByRole("button", { name: /^Права:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Добавить выбранных" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти из группы" })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Название группы/ }),
    ).toBeDisabled();
  });

  it("offers previous history only when inviting colleagues to an existing group", async () => {
    const chatActions = actions();
    const group = {
      ...initialChats[0]!,
      canDelete: true,
      members: initialChats[0]!.members.filter((member) => member.userId !== "malika"),
    };
    renderMessenger({ chats: [group], chatActions });
    fireEvent.click(screen.getByRole("button", { name: "Участники и права" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Удалить группу" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /^Закрыть$/ })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Закрыть окно группы" })).toBeInTheDocument();
    const history = dialog.getByRole("switch", { name: /предыдущую историю/ });
    expect(history).not.toBeChecked();
    fireEvent.click(dialog.getByRole("button", { name: "Малика Нурова" }));
    fireEvent.click(dialog.getByRole("button", { name: "Добавить выбранных" }));
    await waitFor(() => expect(chatActions.add).toHaveBeenCalledWith("finance", ["malika"], false));
    fireEvent.click(history);
    fireEvent.click(dialog.getByRole("button", { name: "Малика Нурова" }));
    fireEvent.click(dialog.getByRole("button", { name: "Добавить выбранных" }));
    await waitFor(() => expect(chatActions.add).toHaveBeenLastCalledWith("finance", ["malika"], true));
  });

  it("keeps exit notices in the chat flow when later messages arrive", () => {
    const leftNotice: ChatMessage = {
      ...initialMessages[0]!, id: "left-notice", chatId: "finance",
      body: "Бахтиёр Самугов больше не в группе", systemKind: "member_left",
      createdAt: "2026-09-27T09:00:00Z", time: "14:00",
    };
    const ownerNotice: ChatMessage = {
      ...leftNotice, id: "owner-notice",
      body: "Вам автоматически передалось право управления данной группой",
      systemKind: "ownership_transferred", createdAt: "2026-09-27T09:00:01Z",
    };
    const laterMessage: ChatMessage = {
      ...initialMessages[0]!, id: "later-message", chatId: "finance",
      body: "Продолжаем работу", createdAt: "2026-09-27T09:01:00Z", time: "14:01",
    };
    const messages = [...initialMessages, leftNotice, ownerNotice];
    const { rerender, props } = renderMessenger({ messages });
    expect(screen.getAllByRole("note").map((note) => note.textContent)).toEqual([
      expect.stringContaining("Бахтиёр Самугов больше не в группе"),
      expect.stringContaining("Вам автоматически передалось право управления данной группой"),
    ]);
    rerender(<FluentProvider theme={webLightTheme}><MessengerView {...props} messages={[...messages, laterMessage]} /></FluentProvider>);
    const notes = screen.getAllByRole("note");
    const conversation = screen.getByLabelText("Переписка");
    expect(notes).toHaveLength(2);
    expect(conversation.textContent?.indexOf(ownerNotice.body)).toBeLessThan(
      conversation.textContent!.indexOf(laterMessage.body),
    );
    expect(notes[0]).toHaveClass("message-system");
  });

  it("sends a reply and mentions, then resets the composer when changing chats", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ id: "sent" });
    renderMessenger({ onSendMessage });
    openMessageMenu("Получил обновлённый счёт на ноутбуки. Сумма 84 600 000 сум, срок оплаты до пятницы.");
    fireEvent.click(screen.getByRole("button", { name: "Ответить" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Упомянуть участника" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "@Бахтиёр Самугов" }));
    fireEvent.change(screen.getByLabelText("Новое сообщение"), {
      target: { value: "Посмотри, пожалуйста" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );
    await waitFor(() =>
      expect(onSendMessage).toHaveBeenCalledWith(
        "finance",
        "Посмотри, пожалуйста",
        [],
        { replyToMessageId: "m1", mentionUserIds: ["baxtiyor"] },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Новое сообщение")).toHaveValue(""),
    );
    await waitFor(() => expect(screen.getByLabelText("Новое сообщение")).toHaveFocus(), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText("Новое сообщение"), {
      target: { value: "Не отправлять другому" },
    });
    openMessageMenu("Получил обновлённый счёт на ноутбуки. Сумма 84 600 000 сум, срок оплаты до пятницы.");
    fireEvent.click(screen.getByRole("button", { name: "Ответить" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Бахтиёр Самугов.*Возьму задачу/ }),
    );
    expect(screen.getByLabelText("Новое сообщение")).toHaveValue("");
    expect(screen.queryByLabelText("Отменить ответ")).not.toBeInTheDocument();
  });

  it("sends selected files without requiring placeholder text from the user", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ id: "sent-file" });
    renderMessenger({ onSendMessage });
    const file = new File(["report"], "report.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Файлы сообщения"), {
      target: { files: [file] },
    });
    const send = screen.getByRole("button", { name: "Отправить сообщение" });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith(
      "finance",
      "Файл",
      [file],
      { replyToMessageId: undefined, mentionUserIds: [] },
    ));
  });

  it("reveals a sent message only after the composer particle transition finishes", async () => {
    vi.useFakeTimers();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Chrome");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 240,
      bottom: 44,
      left: 0,
      width: 240,
      height: 44,
      toJSON: () => undefined,
    });
    const canvasContext = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let x = 24; x < Math.min(width, 120); x += 3) {
          const index = (12 * width + x) * 4;
          data[index] = 41;
          data[index + 1] = 58;
          data[index + 2] = 85;
          data[index + 3] = 255;
        }
        return { data, width, height, colorSpace: "srgb" } as ImageData;
      }),
      measureText: vi.fn((value: string) => ({
        width: value.length * 7,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 3,
      })),
      rect: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
      fillStyle: "",
      font: "",
      textBaseline: "alphabetic",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D,
    );

    function TransitionHarness() {
      const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
      const onSendMessage = async (chatId: string, body: string) => {
        const message: ChatMessage = {
          id: "particle-message",
          chatId,
          authorId: "aziza",
          body,
          time: "12:00",
          own: true,
        };
        setMessages((current) => [...current, message]);
        return message;
      };
      return (
        <FluentProvider theme={webLightTheme}>
          <MessengerView
            {...renderMessengerDefaults}
            messages={messages}
            onSendMessage={onSendMessage}
          />
        </FluentProvider>
      );
    }

    const renderMessengerDefaults: Parameters<typeof MessengerView>[0] = {
      token: "access-token",
      currentUserId: "aziza",
      currentUserRole: "employee",
      chats: initialChats,
      messages: initialMessages,
      tasks: initialTasks,
      people,
      attachments: [],
      chatActions: actions(),
      onSendMessage: vi.fn(),
      onSendVoiceMessage: vi.fn(),
      onReactMessage: vi.fn(),
      onPinMessage: vi.fn(),
      onEditMessage: vi.fn(),
      onDeleteMessage: vi.fn(),
      onCreateTaskFromMessage: vi.fn(),
      onDownloadAttachment: vi.fn(),
      onLoadAttachment: vi.fn(),
      onMarkRead: vi.fn(),
    };

    render(<TransitionHarness />);
    fireEvent.change(screen.getByLabelText("Новое сообщение"), {
      target: { value: "Собираюсь из частиц" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await act(async () => undefined);

    const message = screen.getByText("Собираюсь из частиц").closest(".message");
    expect(message).toHaveClass("message-awaiting-reveal");
    expect(message?.parentElement).toHaveAttribute("hidden");

    const transitionMs = getMessageParticleTiming("Собираюсь из частиц").totalMs;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(transitionMs + 20);
    });
    expect(message).toHaveClass("message-particle-revealing");
    expect(message?.parentElement).not.toHaveAttribute("hidden");
    expect(canvasContext.textBaseline).toBe("alphabetic");
    expect(canvasContext.fillText.mock.calls.at(-1)?.[2]).toBeGreaterThan(10);

    canvasContext.drawImage.mockClear();
    canvasContext.fill.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(canvasContext.fill).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(transitionMs + 20);
    });
    expect(message).not.toHaveClass("message-awaiting-reveal");
    expect(message).not.toHaveClass("message-particle-revealing");
  });

  it("restores the draft when an animated send fails", async () => {
    const onSendMessage = vi.fn().mockRejectedValue(new Error("Сервер временно недоступен"));
    renderMessenger({ onSendMessage });
    const composer = screen.getByLabelText("Новое сообщение");
    fireEvent.change(composer, { target: { value: "Не потерять этот текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Сервер временно недоступен"));
    expect(composer).toHaveValue("Не потерять этот текст");
  });

  it("edits own messages, handles conflicts inline, and requires delete confirmation", async () => {
    const message: ChatMessage = {
      id: "own",
      chatId: "finance",
      authorId: "aziza",
      body: "Мой текст",
      time: "12:00",
      revision: 2,
      canEdit: true,
    };
    const onEditMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Сообщение уже изменилось"));
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ messages: [message], onEditMessage, onDeleteMessage });
    const bubble = screen.getByText("Мой текст").closest(".message-body")!;
    const controls = screen.getByRole("group", { name: "Реакция на сообщение" });
    expect(bubble).toContainElement(controls);
    expect(bubble.parentElement?.querySelector(".message-reactions .message-actions")).toBeNull();
    expect(bubble.querySelector("time")).toHaveTextContent("12:00");
    openMessageMenu("Мой текст");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.change(screen.getByLabelText("Редактирование сообщения"), {
      target: { value: "Обновлённый текст" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Сообщение уже изменилось",
      ),
    );
    expect(onEditMessage).toHaveBeenCalledWith(message, "Обновлённый текст", []);
    expect(screen.getByLabelText("Редактирование сообщения")).toHaveValue(
      "Обновлённый текст",
    );
    fireEvent.click(screen.getByRole("button", { name: "Отменить редактирование" }));
    openMessageMenu("Мой текст");
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDeleteMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Удалить для всех" }));
    await waitFor(() => expect(onDeleteMessage).toHaveBeenCalledWith(message));
    expect(screen.queryByText(/Сообщение будет удалено через/)).not.toBeInTheDocument();
  });

  it("removes an own message from an open chat with a collapsing row", async () => {
    const message: ChatMessage = { id: "own-to-remove", chatId: "finance", authorId: "aziza", body: "Удаляемое сообщение", time: "12:00", canEdit: true };
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ messages: [message], onDeleteMessage });
    const row = screen.getByText(message.body).closest(".message-row");
    expect(row).not.toBeNull();
    openMessageMenu(message.body);
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить для всех" }));
    expect(row).toHaveClass("is-removing");
    await waitFor(() => expect(onDeleteMessage).toHaveBeenCalledWith(message));
  });

  it("animates a colleague's deletion only while this conversation is visible", () => {
    const removed: ChatMessage = { id: "remote-removed", chatId: "finance", authorId: "baxtiyor", body: "Коллега удалил это", time: "12:00" };
    const kept: ChatMessage = { id: "remote-kept", chatId: "finance", authorId: "aziza", body: "Оставшееся сообщение", time: "12:01" };
    const view = renderMessenger({ messages: [removed, kept] });
    const pane = document.querySelector<HTMLElement>(".message-scroll")!;
    const row = screen.getByText(removed.body).closest<HTMLElement>(".message-row")!;
    const visible = vi.spyOn(pane, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    const bounds = vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ height: 60 } as DOMRect);
    view.rerender(<FluentProvider theme={webLightTheme}><MessengerView {...view.props} messages={[removed, kept]} /></FluentProvider>);
    view.rerender(<FluentProvider theme={webLightTheme}><MessengerView {...view.props} messages={[kept]} /></FluentProvider>);
    expect(screen.getByText(removed.body).closest(".message-row")).toHaveClass("is-removing");
    bounds.mockRestore();
    visible.mockRestore();
  });

  it("does not replay a deletion that happened while the conversation was hidden", () => {
    const removed: ChatMessage = { id: "closed-removed", chatId: "finance", authorId: "baxtiyor", body: "Удалено в закрытом чате", time: "12:00" };
    const kept: ChatMessage = { id: "closed-kept", chatId: "finance", authorId: "aziza", body: "Остаётся в чате", time: "12:01" };
    const view = renderMessenger({ messages: [removed, kept] });
    const pane = document.querySelector<HTMLElement>(".message-scroll")!;
    const hidden = vi.spyOn(pane, "getClientRects").mockReturnValue({ length: 0 } as DOMRectList);
    view.rerender(<FluentProvider theme={webLightTheme}><MessengerView {...view.props} messages={[kept]} /></FluentProvider>);
    expect(screen.queryByText(removed.body)).not.toBeInTheDocument();
    expect(document.querySelector(".message-row.is-removing")).not.toBeInTheDocument();
    hidden.mockRestore();
  });

  it("saves each employee's chat background without changing messages", async () => {
    localStorage.removeItem("yuksalish:chat-background:aziza");
    renderMessenger();
    fireEvent.click(screen.getByRole("button", { name: "Выбрать фон переписки" }));
    fireEvent.click(screen.getByRole("button", { name: /Тихий рассвет/ }));
    expect(document.querySelector(".message-scroll")).toHaveAttribute("data-chat-background", "dawn");
    expect(localStorage.getItem("yuksalish:chat-background:aziza")).toBe("dawn");
    expect(screen.getByText(initialMessages[0]!.body)).toBeInTheDocument();
    localStorage.removeItem("yuksalish:chat-background:aziza");
  });

  it("replaces legacy patterned backgrounds with gradient choices", () => {
    localStorage.setItem("yuksalish:chat-background:aziza", "paper");
    renderMessenger();
    expect(document.querySelector(".message-scroll")).toHaveAttribute("data-chat-background", "lagoon");
    fireEvent.click(screen.getByRole("button", { name: "Выбрать фон переписки" }));
    expect(screen.getByRole("button", { name: /Лагуна/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Закат/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Узор|Сюзане|Мозаика|Облака/ })).not.toBeInTheDocument();
    localStorage.removeItem("yuksalish:chat-background:aziza");
  });

  it("supports read-only members and does not render deleted text or its actions", () => {
    const chat: ChatSummary = {
      ...initialChats[0]!,
      permissions: {
        ...initialChats[0]!.permissions,
        sendMessages: false,
        uploadFiles: false,
      },
    };
    renderMessenger({
      chats: [chat],
      messages: [
        {
          id: "removed",
          chatId: "finance",
          authorId: "aziza",
          body: "",
          time: "12:00",
          deletedAt: "2026-09-04T09:00:00Z",
        },
      ],
    });
    expect(screen.queryByLabelText("Новое сообщение")).not.toBeInTheDocument();
    expect(screen.getByText(/Вам доступно только чтение/)).toBeInTheDocument();
    expect(screen.queryByText("Сообщение удалено")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Ответить:/ }),
    ).not.toBeInTheDocument();
  });

  it("shows reactions and a pinned-message list, and delegates both actions", async () => {
    const message: ChatMessage = {
      id: "pinned",
      chatId: "finance",
      authorId: "baxtiyor",
      body: "Важное решение по бюджету",
      time: "14:20",
      reactions: [{
        emoji: "👍",
        count: 3,
        reactedByCurrentUser: true,
        reactorUserIds: ["baxtiyor", "aziza", "malika"],
      }],
      isPinned: true,
      canPin: true,
    };
    const onReactMessage = vi.fn().mockResolvedValue(undefined);
    const onPinMessage = vi.fn().mockResolvedValue(undefined);
    const onOpenPersonProfile = vi.fn();
    renderMessenger({ messages: [message], onReactMessage, onPinMessage, onOpenPersonProfile });

    const reaction = screen.getByRole("button", {
      name: "👍: Бахтиёр Самугов, Азиза Каримова, Малика Нурова",
    });
    expect(reaction).not.toHaveTextContent("3");
    expect(reaction.querySelectorAll(".message-reaction-avatars .fui-Avatar")).toHaveLength(2);
    fireEvent.pointerEnter(reaction);
    expect(screen.queryByText("Поставили реакцию")).not.toBeInTheDocument();
    fireEvent.contextMenu(reaction, { clientX: 80, clientY: 80 });
    const quick = screen.getByText(/Поставили реакцию/).closest(".message-context-menu")!;
    expect(quick).toHaveTextContent("Бахтиёр Самугов");
    expect(quick).toHaveTextContent("Азиза Каримова");
    expect(quick).toHaveTextContent("Малика Нурова");
    expect(quick.parentElement).toHaveClass("fui-FluentProvider");
    expect(quick.querySelectorAll(".message-reaction-people .fui-Avatar")).toHaveLength(3);
    fireEvent.click(within(quick as HTMLElement).getByRole("button", { name: /Азиза Каримова/ }));
    expect(onOpenPersonProfile).toHaveBeenCalledWith("aziza");
    fireEvent.click(reaction);
    await waitFor(() => expect(onReactMessage).toHaveBeenCalledWith(message, "👍"));
    openMessageMenu("Важное решение по бюджету");
    fireEvent.click(screen.getByRole("button", { name: "Реакции · 3" }));
    expect(screen.getByRole("dialog", { name: "Реакции на сообщение" })).toHaveTextContent("Малика Нурова");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Реакции на сообщение" })).not.toBeInTheDocument());
    expect(screen.queryByText(/0 реакций · список сотрудников недоступен/)).not.toBeInTheDocument();
    openMessageMenu("Важное решение по бюджету");
    const unpin = screen.getByRole("button", { name: "Открепить" });
    await waitFor(() => expect(unpin).toBeEnabled());
    fireEvent.click(unpin);
    await waitFor(() => expect(onPinMessage).toHaveBeenCalledWith(message, false));

    fireEvent.click(screen.getByRole("button", { name: /Закреплено: 1/ }));
    const panel = screen.getByRole("region", { name: "Закреплённые сообщения" });
    expect(panel).toHaveTextContent("Важное решение по бюджету");
    expect(within(panel).getByText("Бахтиёр Самугов")).toBeInTheDocument();
  });

  it("allows adding a reaction to the current user's own message", async () => {
    const ownMessage: ChatMessage = {
      id: "own-reaction",
      chatId: "finance",
      authorId: "aziza",
      body: "Моё сообщение",
      time: "14:22",
      own: true,
      reactions: [{
        emoji: "👍",
        count: 1,
        reactedByCurrentUser: false,
        reactorUserIds: ["baxtiyor"],
      }],
    };
    const onReactMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ messages: [ownMessage], onReactMessage });

    const message = screen.getByText("Моё сообщение").closest(".message");
    expect(message).not.toBeNull();
    fireEvent.pointerEnter(message!);
    expect(message!.querySelector(".message-actions")).toHaveClass("is-visible");
    expect(screen.getByRole("button", { name: "Добавить реакцию" })).toBeEnabled();
    fireEvent.pointerLeave(message!);
    expect(message!.querySelector(".message-actions")).not.toHaveClass("is-visible");
    fireEvent.focus(message!);
    const reaction = screen.getByRole("button", { name: "👍: Бахтиёр Самугов" });
    expect(reaction).toHaveTextContent("👍");
    expect(reaction).not.toHaveTextContent("1");
    expect(reaction.querySelector(".message-reaction-avatars")).not.toBeInTheDocument();
    fireEvent.click(reaction);

    await waitFor(() => expect(onReactMessage).toHaveBeenCalledWith(ownMessage, "👍"));
  });

  it("forwards a message to another writable chat", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ id: "forwarded" });
    renderMessenger({ onSendMessage });
    const source = initialMessages[0]!;

    openMessageMenu(source.body);
    fireEvent.click(screen.getByRole("button", { name: "Переслать" }));
    const drawer = screen.getByRole("dialog", { name: "Переслать сообщение" });
    fireEvent.click(within(drawer).getByRole("button", { name: /Бахтиёр Самугов/ }));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith(
      "baxtiyor",
      `Переслано от Дилшод Рахимов:\n${source.body}`,
      [],
      { mentionUserIds: [] },
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Переслать сообщение" })).not.toBeInTheDocument());
  });

  it("loads compressed voice data only when playback is requested", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const onLoadAttachment = vi.fn().mockResolvedValue(new Blob(["voice"], { type: "audio/webm" }));
    renderMessenger({
      messages: [{ id: "voice", chatId: "finance", authorId: "aziza", body: "Голосовое сообщение", time: "09:00", canEdit: true }],
      attachments: [{
        id: "voice-file",
        ownerType: "message",
        ownerId: "voice",
        fileName: "voice.webm",
        contentType: "audio/webm;codecs=opus",
        byteSize: 29_000,
        sha256: "a".repeat(64),
        uploadedByUserId: "aziza",
        documentRole: "general",
        mediaKind: "voice",
        mediaDurationMs: 7_000,
        mediaCodec: "opus",
        createdAt: "2026-09-07T09:00:00Z",
      }],
      onLoadAttachment,
    });
    expect(screen.queryByText("Голосовое сообщение")).not.toBeInTheDocument();
    expect(onLoadAttachment).not.toHaveBeenCalled();
    const speed = screen.getByRole("button", { name: "Скорость воспроизведения: 1×" });
    fireEvent.click(speed);
    expect(screen.getByRole("button", { name: "Скорость воспроизведения: 1.5×" })).toBeInTheDocument();
    expect((screen.getByLabelText("Голосовое сообщение") as HTMLAudioElement).playbackRate).toBe(1.5);
    fireEvent.click(screen.getByRole("button", { name: "Воспроизвести" }));
    await waitFor(() => expect(onLoadAttachment).toHaveBeenCalled());
    expect(await screen.findByLabelText("Голосовое сообщение")).toHaveAttribute("src", "blob:voice");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("keeps a failed group form available for retry", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.create).mockRejectedValue(
      new Error("Сотрудник недоступен"),
    );
    render(
      <FluentProvider theme={webLightTheme}>
        <ChatManagement
          token="access-token"
          currentUserId="aziza"
          people={people}
          actions={chatActions}
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />
      </FluentProvider>,
    );
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox", { name: /Название группы/ }), {
      target: { value: "Команда запуска" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Иконка: Звезда" }));
    fireEvent.click(dialog.getByRole("button", { name: "Бахтиёр Самугов" }));
    fireEvent.click(dialog.getByRole("button", { name: "Малика Нурова" }));
    fireEvent.click(dialog.getByRole("button", { name: "Создать группу" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Сотрудник недоступен",
      ),
    );
    expect(chatActions.create).toHaveBeenCalledWith({
      kind: "group",
      title: "Команда запуска",
      description: "",
      memberIds: ["baxtiyor", "malika"],
      avatarIconKey: "star",
    });
    expect(dialog.getByRole("button", { name: "Иконка: Звезда" })).toHaveAttribute("aria-pressed", "true");
    expect(
      dialog.getByRole("button", { name: "Малика Нурова" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(dialog.getByRole("textbox", { name: /Название группы/ })).toHaveValue("Команда запуска");
  });

  it("lists registered colleagues without existing chats and opens a direct dialog on selection", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.create).mockResolvedValue({
      ...initialChats[1]!,
      id: "direct-malika",
      title: "Малика Нурова",
      members: [
        initialChats[1]!.members[0]!,
        { ...initialChats[1]!.members[1]!, userId: "malika" },
      ],
    });
    renderMessenger({ chats: [initialChats[1]!], chatActions });

    fireEvent.click(screen.getByRole("button", { name: /Малика Нурова/ }));

    await waitFor(() => expect(chatActions.create).toHaveBeenCalledWith({
      kind: "direct",
      title: "",
      description: "",
      memberIds: ["malika"],
    }));
  });

  it("lets a member leave a regular group from the row menu", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.remove).mockResolvedValue(undefined);
    const group = {
      ...initialChats[0]!,
      ownerId: "baxtiyor",
      canDelete: false,
      members: initialChats[0]!.members.map((member) => ({
        ...member,
        role: member.userId === "baxtiyor" ? "owner" as const : "member" as const,
      })),
    };
    renderMessenger({ chats: [group], chatActions });

    openChatMenu("finance");
    fireEvent.click(screen.getByRole("menuitem", { name: "Выйти из группы" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Выйти из группы?" })).getByRole("button", { name: "Выйти" }));

    await waitFor(() => expect(chatActions.remove).toHaveBeenCalledWith("finance", "aziza"));
  });

  it("lets an owner leave while keeping the group for remaining members", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.remove).mockResolvedValue(undefined);
    renderMessenger({ chats: [{ ...initialChats[0]!, canDelete: true }], chatActions });

    openChatMenu("finance");
    fireEvent.click(screen.getByRole("menuitem", { name: "Выйти из группы" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Выйти из группы?" })).getByRole("button", { name: "Выйти" }));

    await waitFor(() => expect(chatActions.remove).toHaveBeenCalledWith("finance", "aziza"));
    expect(chatActions.delete).not.toHaveBeenCalled();
  });

  it("never exposes deletion for a service chat even if stale data says it is allowed", () => {
    renderMessenger({ chats: [{ ...initialChats[4]!, canDelete: true }] });
    fireEvent.click(screen.getByRole("button", { name: /^Чаты задач/ }));
    openChatMenu(initialChats[4]!.id);
    expect(screen.queryByRole("menuitem", { name: "Удалить чат" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Выйти из группы" })).not.toBeInTheDocument();
  });

  it("does not show task chats in the general chat bucket and places them in Чаты задач", () => {
    renderMessenger();
    const taskChat = "Задача · Согласовать график";
    const normalChat = "Финансы и закупки";
    const buckets = screen.getByRole("group", { name: "Папки чатов" });
    expect(buckets).toHaveClass("is-chats");
    expect(buckets.querySelector(".chat-bucket-slider")).toBeInTheDocument();
    const generalChats = screen.getByRole("list", { name: "Чаты" });
    expect(within(generalChats).queryByText(taskChat)).not.toBeInTheDocument();
    expect(within(generalChats).getByText(normalChat)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Чаты задач/ }));
    expect(buckets).toHaveClass("is-task-chats");
    expect(within(buckets).getByText("Чаты задач")).toHaveClass("chat-bucket-label");
    const taskChats = screen.getByRole("list", { name: "Чаты задач" });
    expect(within(taskChats).getByText(taskChat)).toBeInTheDocument();
    expect(within(taskChats).queryByText(normalChat)).not.toBeInTheDocument();
  });
});
