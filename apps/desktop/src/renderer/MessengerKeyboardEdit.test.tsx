import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ChatMessage } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { MessengerView } from "./MessengerView";
import { initialChats, initialTasks, people } from "./test-fixtures/demo-data";

afterEach(cleanup);

function renderKeyboardMessenger(overrides: Partial<Parameters<typeof MessengerView>[0]>) {
  const props: Parameters<typeof MessengerView>[0] = {
    token: "access-token",
    currentUserId: "aziza",
    currentUserRole: "employee",
    chats: initialChats,
    messages: [],
    tasks: initialTasks,
    people,
    attachments: [],
    chatActions: {
      create: vi.fn(), update: vi.fn(), add: vi.fn(), setMember: vi.fn(),
      remove: vi.fn(), transfer: vi.fn(), delete: vi.fn(),
    },
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
  render(<FluentProvider theme={webLightTheme}><MessengerView {...props} /></FluentProvider>);
  return props;
}

it("copies the last own message into the composer with ArrowUp and saves it with Enter", async () => {
  const own: ChatMessage = {
    id: "latest-own", chatId: "finance", authorId: "aziza", body: "Последнее своё",
    time: "12:00", canEdit: true, revision: 3,
  };
  const onEditMessage = vi.fn().mockResolvedValue(undefined);
  renderKeyboardMessenger({
    messages: [
      { ...own, id: "older", body: "Старое своё" },
      own,
      { ...own, id: "incoming", authorId: "baxtiyor", body: "Ответ коллеги", canEdit: false },
      { ...own, id: "removed", deletedAt: "2026-09-04T09:00:00Z", body: "" },
      { ...own, id: "other-chat", chatId: "other", body: "В другом чате" },
    ],
    onEditMessage,
  });

  fireEvent.change(screen.getByLabelText("Поиск в переписке"), { target: { value: "Старое" } });
  expect(screen.queryByText("Последнее своё")).not.toBeInTheDocument();
  const composer = screen.getByLabelText("Новое сообщение");
  composer.focus();
  fireEvent.keyDown(composer, { key: "ArrowUp" });
  const editor = screen.getByLabelText("Редактирование сообщения");
  expect(editor).toHaveValue(own.body);
  expect(editor).toHaveFocus();
  expect((editor as HTMLInputElement).selectionStart).toBe(own.body.length);
  fireEvent.change(editor, { target: { value: "Исправленный текст" } });
  fireEvent.keyDown(editor, { key: "Enter" });
  await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith(own, "Исправленный текст", []));
  await waitFor(() => expect(screen.queryByLabelText("Редактирование сообщения")).not.toBeInTheDocument());
  expect(composer).toHaveFocus();
  expect(screen.getByLabelText("Поиск в переписке")).toHaveValue("Старое");
});

it("suggests participants and saves new mentions while editing", async () => {
  const own: ChatMessage = {
    id: "own", chatId: "finance", authorId: "aziza", body: "Проверьте документ",
    time: "12:00", canEdit: true, mentionUserIds: [],
  };
  const onEditMessage = vi.fn().mockResolvedValue(undefined);
  renderKeyboardMessenger({ messages: [own], onEditMessage });

  fireEvent.keyDown(screen.getByLabelText("Новое сообщение"), { key: "ArrowUp" });
  const editor = screen.getByLabelText("Редактирование сообщения");
  fireEvent.change(editor, { target: { value: "Проверьте документ @" } });
  expect(screen.getByRole("region", { name: "Упомянуть участников" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "@Бахтиёр Самугов" }));
  expect(editor).toHaveValue("Проверьте документ");
  fireEvent.keyDown(editor, { key: "Enter" });
  await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith(own, "Проверьте документ", ["baxtiyor"]));
});

it("preserves the composer draft and current edit; Escape returns focus without saving", () => {
  const own: ChatMessage = { id: "own", chatId: "finance", authorId: "aziza", body: "Мой текст", time: "12:00", canEdit: true };
  const props = renderKeyboardMessenger({ messages: [own] });
  const composer = screen.getByLabelText("Новое сообщение");
  for (const draft of ["Черновик", " "]) {
    fireEvent.change(composer, { target: { value: draft } });
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    expect(screen.queryByLabelText("Редактирование сообщения")).not.toBeInTheDocument();
    expect(composer).toHaveValue(draft);
  }
  fireEvent.change(composer, { target: { value: "" } });
  fireEvent.keyDown(composer, { key: "ArrowUp" });
  const editor = screen.getByLabelText("Редактирование сообщения");
  fireEvent.change(editor, { target: { value: "Несохранённое изменение" } });
  fireEvent.keyDown(editor, { key: "ArrowUp" });
  expect(editor).toHaveValue("Несохранённое изменение");
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(screen.queryByLabelText("Редактирование сообщения")).not.toBeInTheDocument();
  expect(composer).toHaveFocus();
  expect(props.onEditMessage).not.toHaveBeenCalled();
  fireEvent.keyDown(composer, { key: "ArrowUp" });
  expect(screen.getByLabelText("Редактирование сообщения")).toHaveValue(own.body);
});

it.each(["ctrlKey", "altKey", "metaKey", "shiftKey", "isComposing"])("ignores ArrowUp with %s", (modifier) => {
  renderKeyboardMessenger({ messages: [{ id: "own", chatId: "finance", authorId: "aziza", body: "Мой текст", time: "12:00", canEdit: true }] });
  fireEvent.keyDown(screen.getByLabelText("Новое сообщение"), { key: "ArrowUp", [modifier]: true });
  expect(screen.queryByLabelText("Редактирование сообщения")).not.toBeInTheDocument();
});

it("does not fall back to older messages when the latest own message cannot be edited", () => {
  const own: ChatMessage = { id: "old", chatId: "finance", authorId: "aziza", body: "Старое", time: "12:00", canEdit: true };
  renderKeyboardMessenger({ messages: [own, { ...own, id: "last", body: "Новое", canEdit: false }] });
  fireEvent.keyDown(screen.getByLabelText("Новое сообщение"), { key: "ArrowUp" });
  expect(screen.queryByLabelText("Редактирование сообщения")).not.toBeInTheDocument();
});

it("does nothing when there are no own messages in the active chat", () => {
  renderKeyboardMessenger({ messages: [
    { id: "incoming", chatId: "finance", authorId: "baxtiyor", body: "Коллега", time: "12:00", canEdit: true },
    { id: "other", chatId: "other", authorId: "aziza", body: "Другое", time: "12:00", canEdit: true },
  ] });
  fireEvent.keyDown(screen.getByLabelText("Новое сообщение"), { key: "ArrowUp" });
  expect(screen.queryByLabelText("Редактирование сообщения")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Изменить сообщение:/ })).not.toBeInTheDocument();
});
