import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ChatMessage, ChatSummary } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatManagement, type ChatActions } from "./ChatManagement";
import { initialChats, initialMessages, initialTasks, people } from "./test-fixtures/demo-data";
import { MessengerView } from "./MessengerView";

function actions(): ChatActions {
  return {
    create: vi.fn(),
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

describe("Private messenger", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("exposes chat deletion in the row menu and delays it for undo", async () => {
    vi.useFakeTimers();
    const chatActions = actions();
    vi.mocked(chatActions.delete).mockResolvedValue(undefined);
    renderMessenger({
      chats: [{ ...initialChats[0]!, canDelete: true }],
      chatActions,
    });

    fireEvent.click(screen.getByRole("button", { name: "Действия чата «Финансы и закупки»" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить чат" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Создать чат" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Вы станете владельцем",
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Название группы/ }), {
      target: { value: "Проектная команда" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Бахтиёр Самугов" }));
    expect(
      screen.queryByRole("checkbox", { name: "Дилшод Рахимов" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    await waitFor(() =>
      expect(chatActions.create).toHaveBeenCalledWith({
        kind: "group",
        title: "Проектная команда",
        description: "",
        memberIds: ["baxtiyor"],
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
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Название группы/ }),
    ).toBeDisabled();
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
    expect(screen.getByLabelText("Новое сообщение")).toHaveFocus();
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
    expect(bubble).not.toContainElement(controls);
    expect(bubble.parentElement).toContainElement(controls);
    expect(bubble.querySelector("time")).toHaveTextContent("12:00");
    openMessageMenu("Мой текст");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.change(screen.getByLabelText("Изменить текст сообщения"), {
      target: { value: "Обновлённый текст" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить сообщение" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Сообщение уже изменилось",
      ),
    );
    expect(onEditMessage).toHaveBeenCalledWith(message, "Обновлённый текст");
    expect(screen.getByLabelText("Изменить текст сообщения")).toHaveValue(
      "Обновлённый текст",
    );
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    openMessageMenu("Мой текст");
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDeleteMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Удалить для всех" }));
    expect(screen.getByText(/Сообщение будет удалено через/)).toBeInTheDocument();
    expect(onDeleteMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Вернуть" }));
    expect(onDeleteMessage).not.toHaveBeenCalled();
  });

  it("opens the last own message with ArrowUp, outside search results, then saves its revision", async () => {
    const own: ChatMessage = { id: "latest-own", chatId: "finance", authorId: "aziza", body: "Последнее своё", time: "12:00", canEdit: true, revision: 3 };
    const onEditMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ messages: [
      { ...own, id: "older", body: "Старое своё" },
      own,
      { ...own, id: "incoming", authorId: "baxtiyor", body: "Ответ коллеги", canEdit: false },
      { ...own, id: "removed", deletedAt: "2026-09-04T09:00:00Z", body: "" },
      { ...own, id: "other-chat", chatId: "other", body: "В другом чате" },
    ], onEditMessage });
    fireEvent.change(screen.getByLabelText("Поиск в переписке"), { target: { value: "Старое" } });
    expect(screen.queryByText("Последнее своё")).not.toBeInTheDocument();
    const composer = screen.getByLabelText("Новое сообщение");
    composer.focus();
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    const editor = screen.getByLabelText("Изменить текст сообщения");
    expect(editor).toHaveValue(own.body);
    expect(editor).toHaveFocus();
    expect((editor as HTMLTextAreaElement).selectionStart).toBe(own.body.length);
    fireEvent.change(editor, { target: { value: "Исправленный текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить сообщение" }));
    await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith(own, "Исправленный текст"));
    await waitFor(() => expect(screen.queryByLabelText("Изменить текст сообщения")).not.toBeInTheDocument());
    expect(composer).toHaveFocus();
    expect(screen.getByLabelText("Поиск в переписке")).toHaveValue("Старое");
  });

  it("preserves the composer draft and current edit; Escape returns focus without saving", () => {
    const own: ChatMessage = { id: "own", chatId: "finance", authorId: "aziza", body: "Мой текст", time: "12:00", canEdit: true };
    const { props } = renderMessenger({ messages: [own] });
    const composer = screen.getByLabelText("Новое сообщение");
    for (const draft of ["Черновик", " "]) {
      fireEvent.change(composer, { target: { value: draft } });
      fireEvent.keyDown(composer, { key: "ArrowUp" });
      expect(screen.queryByLabelText("Изменить текст сообщения")).not.toBeInTheDocument();
      expect(composer).toHaveValue(draft);
    }
    fireEvent.change(composer, { target: { value: "" } });
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    const editor = screen.getByLabelText("Изменить текст сообщения");
    fireEvent.change(editor, { target: { value: "Несохранённое изменение" } });
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    expect(editor).toHaveValue("Несохранённое изменение");
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByLabelText("Изменить текст сообщения")).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
    expect(props.onEditMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    expect(screen.getByLabelText("Изменить текст сообщения")).toHaveValue(own.body);
  });

  it.each(["ctrlKey", "altKey", "metaKey", "shiftKey", "isComposing"])("ignores ArrowUp with %s", (modifier) => {
    renderMessenger({ messages: [{ id: "own", chatId: "finance", authorId: "aziza", body: "Мой текст", time: "12:00", canEdit: true }] });
    fireEvent.keyDown(screen.getByLabelText("Новое сообщение"), { key: "ArrowUp", [modifier]: true });
    expect(screen.queryByLabelText("Изменить текст сообщения")).not.toBeInTheDocument();
  });

  it("does not fall back to older messages when the latest own message cannot be edited", () => {
    const own: ChatMessage = { id: "old", chatId: "finance", authorId: "aziza", body: "Старое", time: "12:00", canEdit: true };
    renderMessenger({ messages: [own, { ...own, id: "last", body: "Новое", canEdit: false }] });
    fireEvent.keyDown(screen.getByLabelText("Новое сообщение"), { key: "ArrowUp" });
    expect(screen.queryByLabelText("Изменить текст сообщения")).not.toBeInTheDocument();
  });

  it("does nothing when there are no own messages in the active chat", () => {
    renderMessenger({ messages: [
      { id: "incoming", chatId: "finance", authorId: "baxtiyor", body: "Коллега", time: "12:00", canEdit: true },
      { id: "other", chatId: "other", authorId: "aziza", body: "Другое", time: "12:00", canEdit: true },
    ] });
    fireEvent.keyDown(screen.getByLabelText("Новое сообщение"), { key: "ArrowUp" });
    expect(screen.queryByLabelText("Изменить текст сообщения")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Изменить сообщение:/ })).not.toBeInTheDocument();
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
    expect(screen.getByText("Сообщение удалено")).toBeInTheDocument();
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
      reactions: [{ emoji: "👍", count: 3, reactedByCurrentUser: true }],
      isPinned: true,
      canPin: true,
    };
    const onReactMessage = vi.fn().mockResolvedValue(undefined);
    const onPinMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ messages: [message], onReactMessage, onPinMessage });

    fireEvent.click(screen.getByRole("button", { name: "👍: 3" }));
    await waitFor(() => expect(onReactMessage).toHaveBeenCalledWith(message, "👍"));
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
      reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: false }],
    };
    const onReactMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ messages: [ownMessage], onReactMessage });

    const message = screen.getByText("Моё сообщение").closest(".message");
    expect(message).not.toBeNull();
    fireEvent.focus(message!);
    expect(screen.getByRole("button", { name: "Добавить реакцию" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "👍: 1" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Прослушать" }));
    await waitFor(() => expect(onLoadAttachment).toHaveBeenCalled());
    expect(await screen.findByLabelText("Голосовое сообщение")).toHaveAttribute("src", "blob:voice");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("restricts direct creation to one colleague and preserves failed forms", async () => {
    const chatActions = actions();
    vi.mocked(chatActions.create).mockRejectedValue(
      new Error("Сотрудник недоступен"),
    );
    render(
      <FluentProvider theme={webLightTheme}>
        <ChatManagement
          currentUserId="aziza"
          people={people}
          actions={chatActions}
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />
      </FluentProvider>,
    );
    fireEvent.change(screen.getByLabelText("Тип разговора"), {
      target: { value: "direct" },
    });
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Бахтиёр Самугов" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Малика Нурова" }));
    expect(
      dialog.getByRole("checkbox", { name: "Бахтиёр Самугов" }),
    ).not.toBeChecked();
    fireEvent.click(dialog.getByRole("button", { name: "Открыть диалог" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Сотрудник недоступен",
      ),
    );
    expect(chatActions.create).toHaveBeenCalledWith({
      kind: "direct",
      title: "",
      description: "",
      memberIds: ["malika"],
    });
    expect(
      dialog.getByRole("checkbox", { name: "Малика Нурова" }),
    ).toBeChecked();
  });

  it("does not show task chats in the general chat bucket and places them in Чаты задач", () => {
    renderMessenger();
    const taskChat = "Задача · Согласовать график";
    const normalChat = "Финансы и закупки";
    const generalChats = screen.getByRole("list", { name: "Чаты" });
    expect(within(generalChats).queryByText(taskChat)).not.toBeInTheDocument();
    expect(within(generalChats).getByText(normalChat)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Чаты задач/ }));
    const taskChats = screen.getByRole("list", { name: "Чаты задач" });
    expect(within(taskChats).getByText(taskChat)).toBeInTheDocument();
    expect(within(taskChats).queryByText(normalChat)).not.toBeInTheDocument();
  });
});
