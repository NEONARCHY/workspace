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
import { initialChats, initialMessages, people } from "./demo-data";
import { MessengerView } from "./MessengerView";

function actions(): ChatActions {
  return {
    create: vi.fn(),
    update: vi.fn(),
    add: vi.fn(),
    setMember: vi.fn(),
    remove: vi.fn(),
    transfer: vi.fn(),
  };
}
function renderMessenger(
  overrides: Partial<Parameters<typeof MessengerView>[0]> = {},
) {
  const props: Parameters<typeof MessengerView>[0] = {
    currentUserId: "aziza",
    chats: initialChats,
    messages: initialMessages,
    people,
    attachments: [],
    chatActions: actions(),
    onSendMessage: vi.fn(),
    onEditMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onCreateTaskFromMessage: vi.fn(),
    onDownloadAttachment: vi.fn(),
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

describe("Private messenger", () => {
  afterEach(() => {
    cleanup();
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
    fireEvent.click(screen.getAllByRole("button", { name: /^Ответить:/ })[0]!);
    fireEvent.click(
      screen.getByRole("button", { name: "Упомянуть участника" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "@Бахтиёр Самугов" }));
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
    fireEvent.change(screen.getByLabelText("Новое сообщение"), {
      target: { value: "Не отправлять другому" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^Ответить:/ })[0]!);
    fireEvent.click(
      screen.getByRole("button", { name: /Бахтиёр Самугов.*Возьму задачу/ }),
    );
    expect(screen.getByLabelText("Новое сообщение")).toHaveValue("");
    expect(screen.queryByLabelText("Отменить ответ")).not.toBeInTheDocument();
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
    fireEvent.click(
      screen.getByRole("button", { name: "Изменить сообщение: Мой текст" }),
    );
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
    fireEvent.click(
      screen.getByRole("button", { name: "Удалить сообщение: Мой текст" }),
    );
    expect(onDeleteMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Удалить для всех" }));
    await waitFor(() => expect(onDeleteMessage).toHaveBeenCalledWith(message));
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
});
