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
import { changeField, editorCaret } from "./test-fixtures/rich-editor";
import { readRichEditor, setEditorSelection } from "./message-rich-text";
import { Dialog, DialogSurface, FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ChatMessage, ChatSummary } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatManagement, type ChatActions } from "./ChatManagement";
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
    dismiss: vi.fn(),
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

it("does not read chats in a closed mini messenger or merely in its list", async () => {
  const onMarkRead = vi.fn();
  const result = renderMessenger({ compact: true, visible: false, onMarkRead });
  expect(onMarkRead).not.toHaveBeenCalled();
  result.rerender(<FluentProvider theme={webLightTheme}><MessengerView {...result.props} visible /></FluentProvider>);
  expect(onMarkRead).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Финансы и закупки/ }));
  await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith("finance"));
  onMarkRead.mockClear();
  result.rerender(<FluentProvider theme={webLightTheme}><MessengerView {...result.props} visible={false} /></FluentProvider>);
  expect(onMarkRead).not.toHaveBeenCalled();
  result.unmount();
});

describe("rich messenger integration", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.getSelection()?.removeAllRanges(); });
  const quoted: ChatMessage = { id: "quote-source", chatId: "finance", authorId: "baxtiyor", body: "Альфа 😀 бета гамма", time: "12:00", canPin: true };
  it("replies with the selected fragment and sends whole-message pin actions", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ id: "sent" }), onPinMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ messages: [quoted], onSendMessage, onPinMessage });
    const body = document.querySelector<HTMLElement>("[data-message-id='quote-source'] [data-message-text]")!;
    setEditorSelection(body, 9, 13); fireEvent.contextMenu(body);
    fireEvent.click(screen.getByRole("button", { name: "Ответить с цитатой" }));
    expect(document.querySelector(".composer-context p")).toHaveTextContent("бета");
    const input = screen.getByLabelText("Новое сообщение"); changeField(input, { target: { value: "Ответ" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith("finance", "Ответ", [], {
      replyToMessageId: quoted.id, replyQuote: { offset: 9, text: "бета" }, entities: [], mentionUserIds: [],
    }));
    setEditorSelection(body, 9, 13); fireEvent.contextMenu(body); fireEvent.click(screen.getByRole("button", { name: "Закрепить" }));
    await waitFor(() => expect(onPinMessage).toHaveBeenCalledWith(quoted, true));
  });
  it("copies only the selection and ignores a selection outside that message", async () => {
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    renderMessenger({ messages: [quoted] });
    const body = document.querySelector<HTMLElement>("[data-message-text]")!;
    setEditorSelection(body, 9, 13); fireEvent.contextMenu(body); fireEvent.click(screen.getByRole("button", { name: "Копировать выделенное" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("бета"));
    const input = screen.getByLabelText("Новое сообщение"); changeField(input, { target: { value: "Чужое выделение" } });
    setEditorSelection(input, 0, 5); fireEvent.contextMenu(body);
    expect(screen.queryByRole("button", { name: "Ответить с цитатой" })).not.toBeInTheDocument();
  });
  it("restores formatting with the draft after a rejected send", async () => {
    const onSendMessage = vi.fn().mockRejectedValue(new Error("Нет связи")); renderMessenger({ onSendMessage });
    const input = screen.getByLabelText("Новое сообщение"); changeField(input, { target: { value: "Жирный текст" } });
    setEditorSelection(input, 0, 6); fireEvent.keyDown(input, { code: "KeyB", key: "b", ctrlKey: true }); fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Нет связи"));
    expect(readRichEditor(input).text).toBe("Жирный текст");
    expect(readRichEditor(input).entities).toEqual([{ type: "bold", offset: 0, length: 6 }]);
    expect(onSendMessage).toHaveBeenCalledWith("finance", "Жирный текст", [], expect.objectContaining({ entities: [{ type: "bold", offset: 0, length: 6 }] }));
  });
  it("offers separate personal/global unpin actions at the top and protects chairman pins", async () => {
    const onPinMessage = vi.fn().mockResolvedValue(undefined);
    const ordinary = { ...quoted, isPinned: true, canUnpinForSelf: true, canUnpinForAll: true };
    renderMessenger({ messages: [ordinary], onPinMessage });
    fireEvent.click(screen.getByRole("button", { name: "Закреплено: 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Снять для себя" }));
    await waitFor(() => expect(onPinMessage).toHaveBeenCalledWith(ordinary, false, "self"));
    fireEvent.click(screen.getByRole("button", { name: "Снять для всех" }));
    await waitFor(() => expect(onPinMessage).toHaveBeenCalledWith(ordinary, false, "all"));
    cleanup(); renderMessenger({ messages: [{ ...ordinary, pinProtected: true, canUnpinForSelf: false, canUnpinForAll: false }] });
    fireEvent.click(screen.getByRole("button", { name: "Закреплено: 1" }));
    expect(screen.getByText("Закреп председателя · нельзя снять")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Снять для/ })).not.toBeInTheDocument();
  });
  it("does not count personally hidden pins in the top banner", () => {
    renderMessenger({ messages: [{ ...quoted, isPinned: true, pinHiddenForMe: true }] });
    expect(screen.queryByRole("button", { name: /Закреплено/ })).not.toBeInTheDocument();
  });
});

describe("composer performance and microphone", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("keeps the microphone focusable with an explained recording guard while typing", async () => {
    renderMessenger();
    const mic = screen.getByRole("button", { name: "Записать голосовое сообщение" });
    const input = screen.getByRole("textbox", { name: "Новое сообщение" });
    changeField(input, { target: { value: "Черновик" } });
    expect(mic).not.toBeDisabled();
    expect(mic).toHaveAttribute("aria-disabled", "true");
    expect(mic).toHaveClass("composer-microphone");
    for (const name of ["Прикрепить файл", "Создать мероприятие из чата", "Упомянуть участника", "Записать голосовое сообщение"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("composer-tool-button");
    }
    fireEvent.click(mic);
    expect(input).toHaveTextValue("Черновик");
    fireEvent.focus(mic);
    await waitFor(() => expect(mic).toHaveAccessibleDescription("Чтобы записать голосовое сообщение, отправьте или удалите набранный текст"));
    changeField(input, { target: { value: "" } });
    expect(mic).toHaveAttribute("aria-disabled", "false");
  });
  it("does not rebuild message history on draft keystrokes", () => {
    renderMessenger();
    const dateFormatting = vi.spyOn(Date.prototype, "toLocaleDateString");
    const input = screen.getByRole("textbox", { name: "Новое сообщение" });
    for (const value of ["Т", "Те", "Тес", "Тест"]) changeField(input, { target: { value } });
    expect(input).toHaveTextValue("Тест");
    expect(dateFormatting).not.toHaveBeenCalled();
  });
});

describe("microphone startup without a composer gap", () => {
  const originalDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  afterEach(() => {
    cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (originalDevices) Object.defineProperty(navigator, "mediaDevices", originalDevices);
    else delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  });
  function delayedMicrophone() {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("AudioContext", undefined);
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    let grant!: (value: MediaStream) => void;
    const request = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: request } });
    vi.stubGlobal("MediaRecorder", class {
      static isTypeSupported() { return true; }
      state = "inactive";
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; }
    });
    return { request, stop, grant: () => grant(stream) };
  }
  it("keeps the same composer until capture starts and restores it on cancel", async () => {
    const mic = delayedMicrophone();
    renderMessenger();
    const input = screen.getByRole("textbox", { name: "Новое сообщение" });
    const button = screen.getByRole("button", { name: "Записать голосовое сообщение" });
    fireEvent.click(button);
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBe(input);
    expect(input).toBeEnabled();
    expect(screen.queryByText("Подключаем микрофон")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Запись голосового сообщения" })).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(mic.request).toHaveBeenCalledOnce();
    await act(async () => mic.grant());
    expect(screen.getByText("Идёт запись")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Новое сообщение" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBeInTheDocument();
    expect(mic.stop).toHaveBeenCalledOnce();
  });
  it.each(["typing", "escape"])("cancels pending capture on %s and releases a late permission grant", async action => {
    const mic = delayedMicrophone();
    renderMessenger();
    const input = screen.getByRole("textbox", { name: "Новое сообщение" });
    fireEvent.click(screen.getByRole("button", { name: "Записать голосовое сообщение" }));
    if (action === "typing") changeField(input, { target: { value: "Продолжаю писать" } });
    else fireEvent.keyDown(screen.getByRole("button", { name: "Записать голосовое сообщение" }), { key: "Escape" });
    await act(async () => mic.grant());
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBe(input);
    expect(input).toHaveTextValue(action === "typing" ? "Продолжаю писать" : "");
    expect(screen.queryByText("Идёт запись")).not.toBeInTheDocument();
    expect(mic.stop).toHaveBeenCalledOnce();
  });
});

describe("message media layout", () => {
afterEach(cleanup);
it.each(["Файл", "Комментарий к документу"])("keeps document rows compact without dropping captions: %s", body => {
  renderMessenger({ messages: [{ id: "document-layout", chatId: "finance", authorId: "aziza", body, time: "17:36" }],
    attachments: [{ id: "document", ownerType: "message", ownerId: "document-layout", fileName: "report.doc", contentType: "application/msword", byteSize: 251904, documentRole: "general", sha256: "a".repeat(64), uploadedByUserId: "aziza", createdAt: "2026-10-15T09:00:00Z" }] });
  const bubble = document.querySelector('[data-message-id="document-layout"] .message-body')!;
  expect(bubble).toHaveClass("is-document-message");
  expect(bubble).not.toHaveClass("has-document-footer");
  expect(bubble.querySelector(".message-text")?.textContent ?? "").toBe(body === "Файл" ? "" : body);
  expect(bubble.querySelector(".message-meta")).toHaveTextContent("17:36");
  expect(bubble.querySelector(".attachment-document-details > .message-meta")).not.toBeNull();
  expect(bubble.querySelector(":scope > .message-meta")).toBeNull();
  expect(bubble.querySelector(".attachment-document-copy > small")).toHaveTextContent("246 КБ");
});
it("keeps mention chips and time together without duplicating metadata", () => {
  renderMessenger({ messages: [{ id: "mention-layout", chatId: "finance", authorId: "aziza", body: "!", time: "15:39", mentionUserIds: ["baxtiyor", "dilshod"] }] });
  const bubble = document.querySelector('[data-message-id="mention-layout"] .message-body')!;
  const footer = bubble.querySelector(".message-mentions-footer")!;
  expect(footer.querySelectorAll(".message-mentions .employee-profile-link")).toHaveLength(2);
  expect(footer.querySelector(".message-meta")).toHaveTextContent("15:39");
  expect(bubble.querySelectorAll(".message-meta")).toHaveLength(1);
  expect(bubble.querySelector(":scope > .message-meta")).toBeNull();
});
it.each([false, true])("renders a compact received voice with its original author when forwarded=%s", forwarded => {
  renderMessenger({ messages: [{ id: "voice-layout", chatId: "finance", authorId: "baxtiyor", body: "Голосовое сообщение", time: "12:10",
    forwarded: forwarded ? { kind: "message", authorId: "dilshod", authorName: "Дилшод Рахимов", available: true } : undefined }],
    attachments: [{ id: "voice-file", ownerType: "message", ownerId: "voice-layout", fileName: "voice.webm", contentType: "audio/webm", byteSize: 29000,
      documentRole: "general", sha256: "a".repeat(64), uploadedByUserId: "baxtiyor", mediaKind: "voice", mediaDurationMs: 22000, createdAt: "2026-10-15T09:00:00Z" }] });
  const bubble = document.querySelector('[data-message-id="voice-layout"] .message-body')!;
  expect(bubble).toHaveClass("is-voice-message");
  expect(bubble.querySelector(".voice-player-details")).toHaveTextContent("0:22, 28 КБ12:10");
  expect(bubble.querySelectorAll(".message-meta")).toHaveLength(1);
  expect(bubble.querySelector(".message-forwarded")).toBeNull();
  expect(bubble.querySelector(".message-text")).toBeNull();
  if (forwarded) expect(bubble.querySelector(".message-forwarded-voice")).toHaveTextContent("Переслано от Дилшод Рахимов");
});
it.each(["Файл", "Подпись к фото"])("renders image media without a nested file card: %s", body => {
  renderMessenger({ messages: [{ id: "media-layout", chatId: "finance", authorId: "aziza", body, time: "14:15" }],
    attachments: [{ id: "image", ownerType: "message", ownerId: "media-layout", fileName: "image.png", contentType: "image/png", byteSize: 1000, documentRole: "general", sha256: "a".repeat(64), uploadedByUserId: "aziza", createdAt: "2026-10-15T09:00:00Z" }] });
  const bubble = document.querySelector('[data-message-id="media-layout"] .message-body')!;
  expect(bubble).toHaveClass("is-media-message");
  expect(bubble.querySelector(".message-media-caption")?.textContent ?? "").toBe(body === "Файл" ? "" : body);
  expect(bubble.querySelector(".message-meta")).not.toBeNull();
  expect(bubble.querySelector(".attachment-media-preview")?.children).toHaveLength(1);
});
});

function openChatMenu(chatId: string) {
  const row = document.querySelector(`[data-chat-id="${chatId}"] .chat-row`);
  if (!row) throw new Error(`Chat not found: ${chatId}`);
  fireEvent.contextMenu(row);
}

describe("Private messenger", () => {
  it("offers explicit chat and message menus without right click and keeps the draft on back", async () => {
    const onPersonalChat = vi.fn().mockResolvedValue(undefined);
    const { props } = renderMessenger({ onPersonalChat });
    const input = screen.getByLabelText("Новое сообщение");
    changeField(input, { target: { value: "Сохранить мой черновик" } });
    const message = screen.getByText(initialMessages[0]!.body).closest(".message") as HTMLElement;
    fireEvent.click(within(message).getByRole("button", { name: "Действия сообщения" }));
    expect(screen.getByRole("button", { name: "Ответить" })).toBeInTheDocument();
    expect(props.onSendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Ответить" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "К списку чатов" }));
    expect(input).toHaveTextValue("Сохранить мой черновик");
    const chat = initialChats[0]!;
    fireEvent.click(screen.getByRole("button", { name: `Действия чата: ${chat.title}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "В архив" }));
    await waitFor(() => expect(onPersonalChat).toHaveBeenCalledWith(chat.id, "archive"));
    expect(input).toHaveTextValue("Сохранить мой черновик");
  });
  it("copies the whole message and leaves native field shortcuts unhandled", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderMessenger();
    const text = initialMessages[0]!.body;
    openMessageMenu(text);
    const menu = document.querySelector(".message-context-menu")!;
    const buttons = [...menu.querySelectorAll("button")];
    expect(buttons[0]).toHaveTextContent("Ответить");
    expect(buttons.every(button => button.querySelector(".fui-Button__icon svg"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    const input = screen.getByLabelText("Новое сообщение");
    for (const key of ["c", "v"]) {
      expect(fireEvent.keyDown(input, { key, ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(input, { key, metaKey: true })).toBe(true);
    }
    expect(fireEvent.contextMenu(input)).toBe(true);
  });

  it("reports clipboard denial without modifying the message or composer", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    renderMessenger();
    changeField(screen.getByLabelText("Новое сообщение"), { target: { value: "Черновик" } });
    openMessageMenu(initialMessages[0]!.body);
    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось скопировать"));
    expect(screen.getByLabelText("Новое сообщение")).toHaveTextValue("Черновик");
    expect(screen.getByText(initialMessages[0]!.body)).toBeInTheDocument();
  });

  const fileTransfer = (files: readonly File[] = []) => ({ types: ["Files"], files, items: [], dropEffect: "none" });
  it("pastes any file types into the draft and sends only on explicit confirmation", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ ...initialMessages[0]!, id: "pasted" });
    renderMessenger({ onSendMessage });
    const first = new File(["one"], "keep.txt");
    const files = [new File(["doc"], "letter.docx"), new File(["sheet"], "table.xlsx"),
      new File(["pdf"], "letter.pdf"), new File(["zip"], "archive.zip")];
    changeField(screen.getByLabelText("Файлы сообщения"), { target: { files: [first] } });
    const input = screen.getByLabelText("Новое сообщение");
    changeField(input, { target: { value: "Сохранить подпись" } });
    expect(fireEvent.paste(input, { clipboardData: fileTransfer(files) })).toBe(false);
    for (const file of [first, ...files]) expect(screen.getByRole("button", { name: `Убрать файл ${file.name}` })).toBeInTheDocument();
    expect(input).toHaveTextValue("Сохранить подпись");
    expect(onSendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith(initialChats[0]!.id, "Сохранить подпись", [first, ...files], expect.any(Object)));
  });
  it("pastes plain text safely and does not attach files from search fields or the chat list", () => {
    renderMessenger();
    const input = screen.getByLabelText("Новое сообщение");
    expect(fireEvent.paste(input, { clipboardData: { types: ["text/plain"], files: [], items: [], getData: () => "Вставленный текст" } })).toBe(false);
    const transfer = fileTransfer([new File(["no"], "outside.txt")]);
    expect(fireEvent.paste(screen.getByPlaceholderText("Найти сообщение в этом чате"), { clipboardData: transfer })).toBe(true);
    expect(fireEvent.paste(document.querySelector(".list-pane")!, { clipboardData: transfer })).toBe(true);
    expect(screen.queryByRole("button", { name: "Убрать файл outside.txt" })).not.toBeInTheDocument();
  });
  it("accepts file clipboard items when FileList is empty and rejects directories or unreadable items", () => {
    renderMessenger();
    const input = screen.getByLabelText("Новое сообщение");
    const file = new File(["test"], "item.bin");
    const item = { kind: "file", getAsFile: () => file };
    fireEvent.paste(input, { clipboardData: { ...fileTransfer(), items: [item] } });
    expect(screen.getByRole("button", { name: "Убрать файл item.bin" })).toBeInTheDocument();
    fireEvent.paste(input, { clipboardData: { ...fileTransfer(), items: [{ ...item, webkitGetAsEntry: () => ({ isDirectory: true }) }] } });
    expect(screen.getByRole("alert")).toHaveTextContent("загрузка папок не поддерживается");
    fireEvent.paste(input, { clipboardData: { ...fileTransfer(), items: [{ kind: "file", getAsFile: () => null }] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось прочитать файлы из буфера");
    expect(screen.getAllByRole("button", { name: "Убрать файл item.bin" })).toHaveLength(1);
  });
  it.each(["sendMessages", "uploadFiles"] as const)("blocks file paste when %s is denied", permission => {
    const chat = { ...initialChats[0]!, permissions: { ...initialChats[0]!.permissions, [permission]: false } };
    const { props } = renderMessenger({ chats: [chat] });
    fireEvent.paste(screen.getByRole("region", { name: /^Чат:/ }), { clipboardData: fileTransfer([new File(["no"], "denied.bin")]) });
    expect(screen.getByRole("alert")).toHaveTextContent(permission === "sendMessages" ? "нельзя отправлять" : "Вложения запрещены");
    expect(screen.queryByRole("button", { name: "Убрать файл denied.bin" })).not.toBeInTheDocument();
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });
  it("rejects an oversized paste atomically without changing the existing draft", () => {
    renderMessenger();
    const input = screen.getByLabelText("Новое сообщение");
    changeField(input, { target: { value: "Сохранить" } });
    const huge = new File(["test"], "huge.pdf");
    Object.defineProperty(huge, "size", { value: 26 * 1024 * 1024 });
    fireEvent.paste(input, { clipboardData: fileTransfer([new File(["ok"], "small.txt"), huge]) });
    expect(screen.getByRole("alert")).toHaveTextContent("25 МБ");
    expect(input).toHaveTextValue("Сохранить");
    expect(screen.queryByRole("button", { name: "Убрать файл small.txt" })).not.toBeInTheDocument();
  });
  it("targets only the conversation without flickering across nested elements and cancels cleanly", () => {
    const { props } = renderMessenger();
    const workspace = screen.getByRole("region", { name: "Мессенджер" });
    const root = screen.getByRole("region", { name: /^Чат:/ });
    const pane = root.querySelector(".conversation-header")!;
    const transfer = fileTransfer();
    fireEvent.dragEnter(workspace.querySelector(".list-pane")!, { dataTransfer: transfer });
    expect(root).not.toHaveAttribute("data-file-drop");
    fireEvent.dragEnter(root, { dataTransfer: transfer });
    expect(root).toHaveAttribute("data-file-drop", "ready");
    expect(workspace).not.toHaveAttribute("data-file-drop");
    expect(root.querySelector(".messenger-file-drop")).not.toBeNull();
    fireEvent.dragEnter(pane, { dataTransfer: transfer });
    fireEvent.dragLeave(root, { dataTransfer: transfer, relatedTarget: pane });
    expect(root).toHaveAttribute("data-file-drop", "ready");
    fireEvent.dragOver(pane, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("copy");
    fireEvent.dragLeave(pane, { dataTransfer: transfer });
    expect(root).not.toHaveAttribute("data-file-drop");
    fireEvent.dragEnter(pane, { dataTransfer: transfer });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(root).not.toHaveAttribute("data-file-drop");
    fireEvent.dragEnter(pane, { dataTransfer: { types: ["text/plain"] } });
    expect(root).not.toHaveAttribute("data-file-drop");
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });
  it("appends and deduplicates picked and dropped files without sending or replacing text", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ ...initialMessages[0]!, id: "sent-file" });
    renderMessenger({ onSendMessage });
    const first = new File(["one"], "one.txt", { type: "text/plain", lastModified: 1 });
    const second = new File(["two"], "two.txt", { type: "text/plain", lastModified: 2 });
    changeField(screen.getByLabelText("Файлы сообщения"), { target: { files: [first] } });
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Мой черновик" } });
    const root = screen.getByRole("region", { name: /^Чат:/ });
    fireEvent.drop(root, { dataTransfer: fileTransfer([first, second]) });
    expect(screen.getAllByRole("button", { name: "Убрать файл one.txt" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Убрать файл two.txt" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toHaveTextValue("Мой черновик");
    expect(onSendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith(initialChats[0]!.id, "Мой черновик", [first, second], expect.any(Object)));
  });
  it("keeps distinct dropped files with identical metadata", () => {
    renderMessenger();
    const options = { type: "text/plain", lastModified: 1 };
    const first = new File(["AAA"], "same.txt", options);
    const second = new File(["BBB"], "same.txt", options);
    fireEvent.drop(screen.getByRole("region", { name: /^Чат:/ }), { dataTransfer: fileTransfer([first, second]) });
    expect(screen.getAllByRole("button", { name: "Убрать файл same.txt" })).toHaveLength(2);
  });
  it.each(["sendMessages", "uploadFiles"] as const)("refuses dropped files when %s is denied", permission => {
    const chat = { ...initialChats[0]!, permissions: { ...initialChats[0]!.permissions, [permission]: false } };
    const { props } = renderMessenger({ chats: [chat] });
    const root = screen.getByRole("region", { name: /^Чат:/ });
    const transfer = fileTransfer([new File(["test"], "denied.txt")]);
    fireEvent.dragEnter(root, { dataTransfer: transfer });
    expect(root).toHaveAttribute("data-file-drop", "blocked");
    fireEvent.dragOver(root, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("none");
    fireEvent.drop(root, { dataTransfer: transfer });
    expect(screen.queryByRole("button", { name: "Убрать файл denied.txt" })).not.toBeInTheDocument();
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });
  it("keeps existing files and text when a drop batch is too large or contains a folder", () => {
    renderMessenger();
    const keep = new File(["keep"], "keep.txt");
    changeField(screen.getByLabelText("Файлы сообщения"), { target: { files: [keep] } });
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Оставить текст" } });
    const root = screen.getByRole("region", { name: /^Чат:/ });
    const huge = new File(["test"], "huge.pdf");
    Object.defineProperty(huge, "size", { value: 26 * 1024 * 1024 });
    fireEvent.drop(root, { dataTransfer: fileTransfer([new File(["small"], "small.txt"), huge]) });
    expect(screen.getByRole("alert")).toHaveTextContent("25 МБ");
    expect(screen.queryByRole("button", { name: "Убрать файл small.txt" })).not.toBeInTheDocument();
    fireEvent.drop(root, { dataTransfer: { ...fileTransfer(), items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }] } });
    expect(screen.getByRole("alert")).toHaveTextContent("загрузка папок не поддерживается");
    expect(screen.getByRole("button", { name: "Убрать файл keep.txt" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toHaveTextValue("Оставить текст");
  });
  it("blocks file receipt while chat management is open without creating a group", () => {
    const { props } = renderMessenger();
    const root = screen.getByRole("region", { name: /^Чат:/ });
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    const transfer = fileTransfer([new File(["test"], "modal.txt")]);
    fireEvent.dragEnter(root, { dataTransfer: transfer });
    expect(root).toHaveAttribute("data-file-drop", "blocked");
    fireEvent.drop(root, { dataTransfer: transfer });
    expect(root.querySelector(".pending-files")).toBeNull();
    expect(props.chatActions.create).not.toHaveBeenCalled();
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });
  it("blocks files during editing but accepts them into the next draft while a send is pending", async () => {
    let finish: (value: ChatMessage) => void = () => {};
    const onSendMessage = vi.fn(() => new Promise<ChatMessage>(resolve => { finish = resolve; }));
    const own: ChatMessage = { id: "own", chatId: initialChats[0]!.id, authorId: "aziza", body: "Изменяемый текст", time: "12:00", canEdit: true };
    renderMessenger({ onSendMessage, messages: [own] });
    openMessageMenu(own.body);
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    const root = screen.getByRole("region", { name: /^Чат:/ });
    const transfer = fileTransfer([new File(["test"], "blocked.txt")]);
    fireEvent.dragEnter(root, { dataTransfer: transfer });
    expect(root).toHaveAttribute("data-file-drop", "blocked");
    fireEvent.drop(root, { dataTransfer: transfer });
    expect(screen.getByLabelText("Редактирование сообщения")).toHaveTextValue(own.body);
    fireEvent.paste(screen.getByLabelText("Редактирование сообщения"), { clipboardData: transfer });
    expect(screen.getByLabelText("Редактирование сообщения")).toHaveTextValue(own.body);
    fireEvent.keyDown(screen.getByLabelText("Редактирование сообщения"), { key: "Escape" });
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Отправляем" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    fireEvent.dragEnter(root, { dataTransfer: transfer });
    expect(root).toHaveAttribute("data-file-drop", "ready");
    fireEvent.drop(root, { dataTransfer: transfer });
    fireEvent.paste(root, { clipboardData: transfer });
    expect(screen.getByRole("button", { name: "Убрать файл blocked.txt" })).toBeInTheDocument();
    expect(onSendMessage.mock.calls[0]).toEqual([initialChats[0]!.id, "Отправляем", [], { replyToMessageId: undefined, replyQuote: undefined, entities: [], mentionUserIds: [] }]);
    await act(async () => finish({ ...own, id: "sent", body: "Отправляем" }));
  });

  it("ignores drops on the chat list and prevents file navigation outside the conversation", () => {
    const { props } = renderMessenger();
    const transfer = fileTransfer([new File(["test"], "outside.txt")]);
    const list = screen.getByRole("region", { name: "Мессенджер" }).querySelector(".list-pane")!;
    expect(fireEvent.drop(list, { dataTransfer: transfer })).toBe(false);
    expect(screen.queryByRole("button", { name: "Убрать файл outside.txt" })).not.toBeInTheDocument();
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });

  it("prevents file navigation with no selected chat without intercepting ordinary drags", () => {
    renderMessenger({ chats: [], people: [] });
    const root = screen.getByRole("region", { name: "Мессенджер" });
    expect(fireEvent.drop(root, { dataTransfer: fileTransfer([new File(["test"], "outside.txt")]) })).toBe(false);
    expect(fireEvent.drop(root, { dataTransfer: { types: ["text/plain"] } })).toBe(true);
  });

  it.each(["задачи", "проекта", "поездки"] as const)("accepts files into an embedded %s chat draft without sending", contextLabel => {
    const { props, unmount } = renderMessenger();
    unmount();
    const chat = initialChats[0]!;
    render(<FluentProvider theme={webLightTheme}>
      <EmbeddedConversation {...props} chatId={chat.id} contextLabel={contextLabel} />
    </FluentProvider>);
    const wrapper = screen.getByRole("region", { name: `Чат ${contextLabel}: ${chat.title}` });
    const target = within(wrapper).getByRole("region", { name: /^Чат:/ });
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Сохранить черновик" } });
    const transfer = fileTransfer([new File(["test"], "embedded.txt")]);
    fireEvent.dragEnter(target, { dataTransfer: transfer });
    expect(target).toHaveAttribute("data-file-drop", "ready");
    expect(wrapper).not.toHaveAttribute("data-file-drop");
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(target).not.toHaveAttribute("data-file-drop");
    expect(screen.getByRole("button", { name: "Убрать файл embedded.txt" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toHaveTextValue("Сохранить черновик");
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });

  it.each(["self", "both"])("asks which participants should lose the direct chat (%s) and offers five-second undo", async mode => {
    vi.useFakeTimers();
    const chatActions = actions();
    vi.mocked(chatActions.dismiss!).mockResolvedValue(undefined);
    vi.mocked(chatActions.delete).mockResolvedValue(undefined);
    renderMessenger({ chats: [{ ...initialChats[1]!, canDelete: true }], chatActions });
    openChatMenu("baxtiyor");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить чат" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить личный чат?" });
    expect(chatActions.delete).not.toHaveBeenCalled();
    expect(chatActions.dismiss).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: mode === "self" ? /^Удалить у меня/ : /^Удалить у обоих/ }));
    await act(() => vi.advanceTimersByTimeAsync(4_999));
    expect(chatActions.delete).not.toHaveBeenCalled();
    expect(chatActions.dismiss).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(mode === "self" ? chatActions.dismiss : chatActions.delete).toHaveBeenCalledWith("baxtiyor");
    expect(mode === "self" ? chatActions.delete : chatActions.dismiss).not.toHaveBeenCalled();
  });
  it("keeps the direct chat snapshot during closing and refreshes it on the next opening", async () => {
    vi.useFakeTimers();
    const chatActions = actions();
    const chat = { ...initialChats[1]!, canDelete: true };
    const next = { ...chat, id: "next-direct", title: "Другой диалог", canDelete: false };
    renderMessenger({ chats: [chat, next], chatActions });
    openChatMenu(chat.id);
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить чат" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить личный чат?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(dialog).toHaveTextContent(`Выберите, что сделать с диалогом «${chat.title}»`);
    expect(dialog).toHaveTextContent("Диалог исчезнет у обоих участников");
    expect(dialog).not.toHaveTextContent("Удаление для обоих недоступно");
    await act(() => vi.advanceTimersByTimeAsync(300));
    openChatMenu(next.id);
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить чат" }));
    const reopened = screen.getByRole("dialog", { name: "Удалить личный чат?" });
    expect(reopened).toHaveTextContent("Другой диалог");
    expect(within(reopened).getByRole("button", { name: /^Удалить у обоих/ })).toBeDisabled();
    expect(chatActions.dismiss).not.toHaveBeenCalled();
    expect(chatActions.delete).not.toHaveBeenCalled();
  });
  it("cancels direct deletion before sending either kind of request", async () => {
    vi.useFakeTimers();
    const chatActions = actions();
    renderMessenger({ chats: [{ ...initialChats[1]!, canDelete: true }], chatActions });
    openChatMenu("baxtiyor");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить чат" }));
    fireEvent.click(screen.getByRole("button", { name: /^Удалить у меня/ }));
    fireEvent.click(screen.getByText("Вернуть"));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(chatActions.dismiss).not.toHaveBeenCalled();
    expect(chatActions.delete).not.toHaveBeenCalled();
    expect(document.querySelector('[data-chat-id="baxtiyor"]')).toBeInTheDocument();
  });
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
      .toHaveTextValue("Пожалуйста, проверьте документ.");
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
      .toHaveTextValue("Проверьте письмо, пожалуйста.");
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
    changeField(composer, { target: { value: "Глянь документ" } });
    fireEvent.click(screen.getByRole("button", { name: "Переформулировать черновик с ИИ" }));
    fireEvent.click(screen.getByRole("button", { name: "Профессиональный" }));
    await screen.findByText("Будьте добры, проверьте документ.");
    expect(composer).toHaveTextValue("Глянь документ");
    expect(onSendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Заменить мой текст" }));
    expect(composer).toHaveTextValue("Будьте добры, проверьте документ.");
  });
  it("does not show or call AI rewrite without assistant access", () => {
    vi.mocked(rewriteMessengerDraft).mockClear();
    renderMessenger({ canUseAssistant: false });
    changeField(screen.getByLabelText("Новое сообщение"), { target: { value: "Текст" } });
    expect(screen.queryByRole("button", { name: "Переформулировать черновик с ИИ" })).not.toBeInTheDocument();
    expect(rewriteMessengerDraft).not.toHaveBeenCalled();
  });
  it("opens the message menu at the pointer in a viewport portal", () => {
    renderMessenger();
    const message = screen.getByText(initialMessages[0]!.body).closest(".message");
    expect(message).not.toBeNull();

    fireEvent.contextMenu(message!, { clientX: 420, clientY: 260 });

    const menu = screen.getByRole("menu");
    expect(menu.closest(".message-context-stack")).toHaveStyle({ left: "420px", top: "260px" });
    expect(screen.getByRole("group", { name: "Быстрые реакции" }).nextElementSibling).toBe(menu);
    expect(document.querySelector(".conversation-pane")?.contains(menu)).toBe(false);
  });

  it("reacts directly from the context strip and closes the actions", async () => {
    const onReactMessage = vi.fn().mockResolvedValue(undefined);
    renderMessenger({ onReactMessage });
    openMessageMenu(initialMessages[0]!.body);
    fireEvent.click(within(screen.getByRole("group", { name: "Быстрые реакции" })).getByRole("button", { name: "👍" }));
    expect(onReactMessage).toHaveBeenCalledWith(initialMessages[0], "👍");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("keeps the actions open inside the expanded catalog and closes one layer per Escape", async () => {
    renderMessenger();
    openMessageMenu(initialMessages[0]!.body);
    const arrow = screen.getByRole("button", { name: "Все реакции" });
    fireEvent.pointerDown(arrow);
    fireEvent.click(arrow);
    const search = screen.getByRole("textbox", { name: "Поиск эмодзи" });
    fireEvent.pointerDown(search);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Выберите реакцию")).not.toBeInTheDocument());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(arrow).toHaveFocus();
    fireEvent.keyDown(arrow, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("selects from the full context catalog and exposes server errors", async () => {
    const onReactMessage = vi.fn().mockRejectedValue(new Error("Не удалось поставить реакцию"));
    renderMessenger({ onReactMessage });
    openMessageMenu(initialMessages[0]!.body);
    fireEvent.click(screen.getByRole("button", { name: "Все реакции" }));
    const catalog = screen.getByLabelText("Выберите реакцию");
    const emoji = within(catalog).getByRole("button", { name: "🐇" });
    fireEvent.pointerDown(emoji);
    fireEvent.click(emoji);
    expect(onReactMessage).toHaveBeenCalledWith(initialMessages[0], "🐇");
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось поставить реакцию");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Выберите реакцию")).not.toBeInTheDocument();
  });

  it("disables context reactions in a read-only conversation", () => {
    renderMessenger({ chats: [{ ...initialChats[0]!, permissions: { ...initialChats[0]!.permissions, sendMessages: false } }] });
    openMessageMenu(initialMessages[0]!.body);
    expect(within(screen.getByRole("group", { name: "Быстрые реакции" })).getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
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
    expect(screen.getByRole("menu").closest(".message-context-stack")?.parentElement?.parentElement).toBe(dialog.parentElement);
    fireEvent.click(screen.getByRole("button", { name: "Все реакции" }));
    const search = screen.getByRole("textbox", { name: "Поиск эмодзи" });
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Выберите реакцию")).not.toBeInTheDocument());
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
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
    changeField(reasonBox, {
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
    expect(screen.getByText("Можно отменить · 5 сек.")).toBeVisible();
    expect(chatActions.delete).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(chatActions.delete).toHaveBeenCalledWith("finance");
  });
  it("removes an encrypted chat draft after restoring it into the composer", async () => {
    const loadDraft = vi.fn().mockResolvedValue("Текст до обновления");
    const clearDraft = vi.fn().mockResolvedValue(undefined);
    const saveDraft = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("yuksalish", { loadDraft, clearDraft, saveDraft });
    renderMessenger();
    await waitFor(() => expect(screen.getByLabelText("Новое сообщение")).toHaveTextValue("Текст до обновления"));
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
    changeField(screen.getByLabelText("Новое сообщение"), {
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
    changeField(screen.getByRole("textbox", { name: /Название группы/ }), {
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
    changeField(screen.getByLabelText("Роль в группе"), {
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
    expect(notes[0]).toHaveTextContent(leftNotice.body);
    expect(notes[1]).toHaveTextContent(ownerNotice.body);
    expect(notes[0]!.querySelector("svg, strong")).toBeNull();
    expect(notes[1]!.querySelector("svg, strong")).toBeNull();
    expect(notes[0]!.querySelector("time")).toHaveTextContent(leftNotice.time);
    expect(notes[1]!.querySelector("time")).toHaveTextContent(ownerNotice.time);
  });

  it("groups nearby bubbles by author without merging across system notices or long pauses", () => {
    const makeMessage = (id: string, authorId: string, time: string): ChatMessage => ({
      ...initialMessages[0]!, id, chatId: "finance", authorId, body: `Текст ${id}`,
      createdAt: `2026-09-27T${time}:00Z`, time,
    });
    const messages: ChatMessage[] = [
      makeMessage("first", "baxtiyor", "09:00"),
      makeMessage("middle", "baxtiyor", "09:00"),
      makeMessage("second", "baxtiyor", "09:01"),
      { ...makeMessage("notice", "baxtiyor", "09:02"), systemKind: "member_left", body: "Бахтиёр вышел из группы" },
      makeMessage("after-notice", "baxtiyor", "09:03"),
      makeMessage("own-first", "aziza", "09:04"),
      { ...makeMessage("own-last", "aziza", "09:05"), reactions: [
        { emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: ["baxtiyor"] },
      ] },
      makeMessage("late", "aziza", "09:20"),
    ];
    renderMessenger({ messages });
    const row = (id: string) => document.querySelector<HTMLElement>(`.message-row:has([data-message-id="${id}"])`);
    expect(row("first")).toHaveClass("is-group-first");
    expect(row("second")).toHaveClass("is-group-last");
    expect(row("first")?.querySelector(".message-avatar-spacer")).toBeInTheDocument();
    expect(row("middle")).toHaveClass("is-group-middle");
    expect(row("middle")?.querySelector(".message-avatar-spacer")).toBeInTheDocument();
    expect(row("second")?.querySelector(".message-sender-avatar")).toBeInTheDocument();
    expect(row("second")?.querySelector(".message-avatar-spacer")).not.toBeInTheDocument();
    expect(row("second")).toHaveTextContent("Текст second");
    expect(row("after-notice")?.className).not.toMatch(/is-group-/);
    expect(row("after-notice")?.querySelector(".message-sender-avatar")).toBeInTheDocument();
    expect(row("own-first")).toHaveClass("is-group-first");
    expect(row("own-last")).toHaveClass("is-group-last");
    expect(row("own-last")?.querySelector(".message-reaction-emoji img")).toHaveAttribute("src", "/emoji/noto/1f44d-still.webp");
    expect(row("late")?.className).not.toMatch(/is-group-/);
  });

  it("inserts Ctrl+Enter at the selection without sending, then sends preserved newlines with Enter", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ id: "multiline" });
    renderMessenger({ onSendMessage });
    const input = screen.getByLabelText<HTMLDivElement>("Новое сообщение");
    expect(input).toHaveAttribute("contenteditable", "true");
    changeField(input, { target: { value: "Первая удалитьВторая" } });
    setEditorSelection(input, 6, 14);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(input).toHaveTextValue("Первая\nВторая");
    expect(onSendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(editorCaret(input)).toBe(7));
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith("finance", "Первая\n\nВторая", [], expect.any(Object)));
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
    changeField(screen.getByLabelText("Новое сообщение"), {
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
        { replyToMessageId: "m1", replyQuote: undefined, entities: [], mentionUserIds: ["baxtiyor"] },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Новое сообщение")).toHaveTextValue(""),
    );
    await waitFor(() => expect(screen.getByLabelText("Новое сообщение")).toHaveFocus(), { timeout: 3000 });
    changeField(screen.getByLabelText("Новое сообщение"), {
      target: { value: "Не отправлять другому" },
    });
    openMessageMenu("Получил обновлённый счёт на ноутбуки. Сумма 84 600 000 сум, срок оплаты до пятницы.");
    fireEvent.click(screen.getByRole("button", { name: "Ответить" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Бахтиёр Самугов.*Возьму задачу/ }),
    );
    expect(screen.getByLabelText("Новое сообщение")).toHaveTextValue("");
    expect(screen.queryByLabelText("Отменить ответ")).not.toBeInTheDocument();
  });

  it("sends selected files without requiring placeholder text from the user", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ id: "sent-file" });
    renderMessenger({ onSendMessage });
    const file = new File(["report"], "report.pdf", { type: "application/pdf" });
    changeField(screen.getByLabelText("Файлы сообщения"), {
      target: { files: [file] },
    });
    const send = screen.getByRole("button", { name: "Отправить сообщение" });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith(
      "finance",
      "Файл",
      [file],
      { replyToMessageId: undefined, replyQuote: undefined, entities: [], mentionUserIds: [] },
    ));
  });

  it("shows sent text with blur instead of hiding it behind a particle canvas", async () => {
    const visible = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    const defaults = renderMessenger().props;
    cleanup();
    function Harness() {
      const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
      return <FluentProvider theme={webLightTheme}><MessengerView {...defaults} messages={messages}
        onSendMessage={async (chatId, body) => {
          const message: ChatMessage = { id: "blur-message", chatId, authorId: "aziza", body, time: "12:00" };
          setMessages(current => [...current, message]);
          return message;
        }} /></FluentProvider>;
    }
    render(<Harness />);
    changeField(screen.getByLabelText("Новое сообщение"), { target: { value: "Плавное появление" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(document.querySelector('[data-message-id="blur-message"]')).not.toBeNull());
    const message = document.querySelector('[data-message-id="blur-message"]')!;
    expect(message.parentElement).not.toHaveAttribute("hidden");
    expect(message).not.toHaveAttribute("aria-hidden", "true");
    expect(message.querySelector('[data-text-animation="enter"]')).not.toBeNull();
    expect(document.querySelector('[data-text-animation="exit"]')).not.toBeNull();
    expect(document.querySelector(".message-reveal-canvas, .message-vanish-canvas")).toBeNull();
    await waitFor(() => expect(document.querySelector(".composer-send-text")).toBeNull(), { timeout: 2500 });
    expect(message.querySelector(".message-text")).toHaveTextContent("Плавное появление");
    visible.mockRestore();
  });

  it("reveals remote incoming text with the same blur without a local send or history replay", () => {
    const visible = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    const { props, rerender } = renderMessenger();
    expect(document.querySelector('[data-text-animation="enter"]')).toBeNull();
    const incoming: ChatMessage = { id: "remote-blur", chatId: initialMessages[0]!.chatId, authorId: "other", body: "Входящее сообщение", time: "12:00" };
    // Use the current conversation, without invoking its send callback.
    rerender(<FluentProvider theme={webLightTheme}><MessengerView {...props} messages={[...initialMessages, incoming]} /></FluentProvider>);
    expect(document.querySelector('[data-message-id="remote-blur"] [data-text-animation="enter"]')).not.toBeNull();
    expect(props.onSendMessage).not.toHaveBeenCalled();
    visible.mockRestore();
  });

  it("restores the draft when an animated send fails", async () => {
    const onSendMessage = vi.fn().mockRejectedValue(new Error("Сервер временно недоступен"));
    renderMessenger({ onSendMessage });
    const composer = screen.getByLabelText("Новое сообщение");
    changeField(composer, { target: { value: "Не потерять этот текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Сервер временно недоступен"));
    expect(composer).toHaveTextValue("Не потерять этот текст");
  });

  it("keeps typing and controls available while sends wait, preserves order and never clears the next draft on acknowledgement", async () => {
    let finishFirst: ((message: ChatMessage) => void) | undefined;
    let finishSecond: ((message: ChatMessage) => void) | undefined;
    const onSendMessage = vi.fn()
      .mockImplementationOnce(() => new Promise<ChatMessage>((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<ChatMessage>((resolve) => { finishSecond = resolve; }));
    renderMessenger({ onSendMessage });
    const input = screen.getByRole("textbox", { name: "Новое сообщение" });
    changeField(input, { target: { value: "Первое" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(input).toBeEnabled(); expect(input).toHaveTextValue(""); expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Прикрепить файл" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Упомянуть участника" })).toBeEnabled();
    changeField(input, { target: { value: "Второе" } });
    expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeEnabled();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" }); // Empty composer cannot duplicate a queued send.
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    changeField(input, { target: { value: "Третий черновик" } });
    await act(async () => { finishFirst?.({ ...initialMessages[0]!, id: "first-ack" }); });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
    expect(onSendMessage.mock.calls.map((call) => call[1])).toEqual(["Первое", "Второе"]);
    expect(input).toHaveTextValue("Третий черновик");
    await act(async () => { finishSecond?.({ ...initialMessages[0]!, id: "second-ack" }); });
    expect(input).toHaveTextValue("Третий черновик"); expect(input).toBeEnabled();
  });

  it("keeps a failed send separately when new text/files exist, then restores it only into an empty composer", async () => {
    let fail: ((cause: Error) => void) | undefined;
    const onSendMessage = vi.fn().mockImplementationOnce(() => new Promise<ChatMessage>((_, reject) => { fail = reject; }))
      .mockResolvedValue({ id: "second-ok" });
    renderMessenger({ onSendMessage });
    const input = screen.getByRole("textbox", { name: "Новое сообщение" });
    const oldFile = new File(["old"], "old.pdf", { type: "application/pdf" });
    const newFile = new File(["new"], "new.pdf", { type: "application/pdf" });
    changeField(input, { target: { value: "Первый с файлом" } });
    changeField(screen.getByLabelText("Файлы сообщения"), { target: { files: [oldFile] } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    changeField(input, { target: { value: "Новый черновик" } });
    changeField(screen.getByLabelText("Файлы сообщения"), { target: { files: [newFile] } });
    await act(async () => { fail?.(new Error("Сеть недоступна")); });
    expect(input).toHaveTextValue("Новый черновик");
    expect(screen.getByRole("alert")).toHaveTextContent("Первый с файлом");
    expect(screen.getByRole("button", { name: "Вернуть в поле" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
    expect(onSendMessage.mock.calls[0]?.[2]).toEqual([oldFile]);
    expect(onSendMessage.mock.calls[1]?.[2]).toEqual([newFile]);
    fireEvent.click(screen.getByRole("button", { name: "Вернуть в поле" }));
    expect(input).toHaveTextValue("Первый с файлом");
    expect(screen.getByRole("button", { name: "Убрать файл old.pdf" })).toBeInTheDocument();
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
    changeField(screen.getByLabelText("Редактирование сообщения"), {
      target: { value: "Обновлённый текст" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Сообщение уже изменилось",
      ),
    );
    expect(onEditMessage).toHaveBeenCalledWith(message, "Обновлённый текст", [], []);
    expect(screen.getByLabelText("Редактирование сообщения")).toHaveTextValue(
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

  it("opens app-wide confirmation and cancels without deleting or changing the draft", async () => {
    // Give this frame-based focus handoff its own clock after fake-timer undo cases.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
    const message: ChatMessage = { id: "confirm-only", chatId: "finance", authorId: "aziza", body: "Не удалять", time: "12:00", canDelete: true };
    const onDeleteMessage = vi.fn();
    renderMessenger({ messages: [message], onDeleteMessage });
    const pane = screen.getByRole("region", { name: /^Чат:/ });
    const composer = screen.getByRole("textbox", { name: "Новое сообщение" });
    const restoreFocus = vi.spyOn(composer, "focus");
    changeField(composer, { target: { value: "Мой черновик" } });
    openMessageMenu(message.body);
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const dialog = await screen.findByRole("dialog", { name: "Удалить это сообщение?" });
    restoreFocus.mockClear();
    expect(pane).not.toContainElement(dialog);
    expect(document.querySelector(".chat-confirmation")).toBeNull();
    expect(within(dialog).getByText(/История изменений сохранится для аудита/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Удалить это сообщение?" })).not.toBeInTheDocument());
    expect(composer).toHaveTextValue("Мой черновик");
    expect(onDeleteMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(restoreFocus).toHaveBeenCalledWith({ preventScroll: true }));
    openMessageMenu(message.body);
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "Удалить это сообщение?" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Удалить это сообщение?" })).not.toBeInTheDocument());
    expect(onDeleteMessage).not.toHaveBeenCalled();
    expect(composer).toHaveTextValue("Мой черновик");
  });
  it("restores a message when confirmed deletion fails", async () => {
    const message: ChatMessage = { id: "failed-delete", chatId: "finance", authorId: "aziza", body: "Останется в чате", time: "12:00", canDelete: true };
    const onDeleteMessage = vi.fn().mockRejectedValue(new Error("Удаление не разрешено"));
    renderMessenger({ messages: [message], onDeleteMessage });
    openMessageMenu(message.body);
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить для всех" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Удаление не разрешено");
    expect(screen.getByText(message.body).closest(".message-row")).not.toHaveClass("is-removing");
    expect(onDeleteMessage).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByLabelText("Выбрать фон переписки"));
    const picker = within(screen.getByLabelText("Фон переписки"));
    fireEvent.click(picker.getByRole("button", { name: /Тихий рассвет/ }));
    expect(document.querySelector(".message-scroll")).toHaveAttribute("data-chat-background", "dawn");
    expect(localStorage.getItem("yuksalish:chat-background:aziza")).toBe("dawn");
    expect(screen.getByText(initialMessages[0]!.body)).toBeInTheDocument();
    localStorage.removeItem("yuksalish:chat-background:aziza");
  });

  it("replaces legacy patterned backgrounds with gradient choices", () => {
    localStorage.setItem("yuksalish:chat-background:aziza", "paper");
    renderMessenger();
    expect(document.querySelector(".message-scroll")).toHaveAttribute("data-chat-background", "lagoon");
    fireEvent.click(screen.getByLabelText("Выбрать фон переписки"));
    const picker = within(screen.getByLabelText("Фон переписки"));
    expect(picker.getByRole("button", { name: /Лагуна/ })).toBeInTheDocument();
    expect(picker.getByRole("button", { name: /Закат/ })).toBeInTheDocument();
    expect(picker.queryByRole("button", { name: /Узор|Сюзане|Мозаика|Облака/ })).not.toBeInTheDocument();
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
    const unpin = screen.getByRole("button", { name: "Снять закреп для всех" });
    await waitFor(() => expect(unpin).toBeEnabled());
    fireEvent.click(unpin);
    await waitFor(() => expect(onPinMessage).toHaveBeenCalledWith(message, false, "all"));

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
    vi.useFakeTimers();
    fireEvent.pointerEnter(message!);
    act(() => { vi.advanceTimersByTime(499); });
    expect(message!.querySelector(".message-actions")).not.toHaveClass("is-visible");
    act(() => { vi.advanceTimersByTime(1); });
    expect(message!.querySelector(".message-actions")).toHaveClass("is-visible");
    expect(screen.getByRole("button", { name: "Добавить реакцию" })).toBeEnabled();
    fireEvent.pointerLeave(message!);
    expect(message!.querySelector(".message-actions")).not.toHaveClass("is-visible");
    fireEvent.pointerEnter(message!);
    fireEvent.pointerLeave(message!);
    act(() => { vi.advanceTimersByTime(500); });
    expect(message!.querySelector(".message-actions")).not.toHaveClass("is-visible");
    vi.useRealTimers();
    fireEvent.focus(message!);
    expect(message!.querySelector(".message-actions")).toHaveClass("is-visible");
    const reaction = screen.getByRole("button", { name: "👍: Бахтиёр Самугов" });
    expect(reaction.querySelector(".reaction-emoji-art")).toHaveAttribute("src", "/emoji/noto/1f44d-still.webp");
    expect(reaction).not.toHaveTextContent("1");
    expect(reaction.querySelector(".message-reaction-avatars")).not.toBeInTheDocument();
    fireEvent.click(reaction);

    await waitFor(() => expect(onReactMessage).toHaveBeenCalledWith(ownMessage, "👍"));
  });

  it("forwards a message to another writable chat", async () => {
    const onSendMessage = vi.fn().mockResolvedValue({ id: "forwarded" });
    const onForwardContent = vi.fn().mockResolvedValue({ id: "forwarded" });
    renderMessenger({ onSendMessage, onForwardContent });
    const source = initialMessages[0]!;

    openMessageMenu(source.body);
    fireEvent.click(screen.getByRole("button", { name: "Переслать" }));
    const drawer = screen.getByRole("dialog", { name: "Переслать сообщение" });
    fireEvent.click(within(drawer).getByRole("button", { name: /Бахтиёр Самугов/ }));

    await waitFor(() => expect(onForwardContent).toHaveBeenCalledWith(
      "baxtiyor",
      { kind: "message", id: source.id },
      expect.any(String),
    ));
    expect(onSendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Переслать сообщение" })).not.toBeInTheDocument());
  });
  it("selects several messages, keeps them on dialog cancellation and forwards in chat order", async () => {
    const onForwardContent = vi.fn().mockResolvedValue({ id: "forwarded" });
    const messages: ChatMessage[] = [
      { id: "first", chatId: "finance", authorId: "dilshod", body: "Первое с фото", time: "12:00" },
      { id: "second", chatId: "finance", authorId: "aziza", body: "Второе сообщение", time: "12:01" },
    ];
    renderMessenger({ messages, onForwardContent });
    expect(screen.queryByRole("heading", { name: "Сообщения" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать группу" })).toBeInTheDocument();
    openMessageMenu(messages[1]!.body);
    fireEvent.click(screen.getByRole("button", { name: "Выделить" }));
    expect(screen.getByRole("checkbox", { name: "Выделить сообщение: Второе сообщение" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выделить сообщение: Первое с фото" }));
    fireEvent.click(screen.getByRole("button", { name: "Переслать выбранные" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Переслать сообщения" })).getByRole("button", { name: "Отмена" }));
    expect(screen.getByRole("region", { name: "Выделенные сообщения" })).toHaveTextContent("Выбрано: 2");
    fireEvent.click(screen.getByRole("button", { name: "Переслать выбранные" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Переслать сообщения" })).getByRole("button", { name: /Бахтиёр Самугов/ }));
    await waitFor(() => expect(onForwardContent).toHaveBeenCalledTimes(2));
    expect(onForwardContent.mock.calls.map(call => call[1].id)).toEqual(["first", "second"]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Выделенные сообщения" })).not.toBeInTheDocument());
  });

  it.each(["voice", "forwarded", "text"])("keeps the %s timestamp separate from content and compact for voice", kind => {
    renderMessenger({
      messages: [{ id: "timestamp-example", chatId: "finance", authorId: "aziza", body: "Проверочное сообщение", time: "14:15",
        editedAt: "2026-10-08T09:15:00Z",
        forwarded: kind === "forwarded" ? { kind: "message", authorId: "dilshod", authorName: "Дилшод Рахимов", available: true } : undefined }],
      attachments: kind === "voice" ? [{ id: "timestamp-audio", ownerType: "message", ownerId: "timestamp-example",
        fileName: "voice.webm", contentType: "audio/webm", byteSize: 29000, sha256: "a".repeat(64), uploadedByUserId: "aziza",
        documentRole: "general", mediaKind: "voice", mediaDurationMs: 7000, createdAt: "2026-10-08T09:15:00Z" }] : [],
    });
    const body = document.querySelector('[data-message-id="timestamp-example"] .message-body')!;
    const footer = body.querySelector(kind === "voice" ? ".voice-player-details > .message-meta" : ":scope > .message-meta")!;
    const timestamp = footer.querySelector("time.message-timestamp");
    expect(timestamp).toHaveTextContent("изменено · 14:15");
    expect(footer.previousElementSibling).toHaveClass(kind === "voice" ? "voice-player-time" : kind === "forwarded" ? "message-forwarded" : "message-text");
    expect(body.querySelectorAll(".message-meta")).toHaveLength(1);
    expect(body.querySelector(".message-text time, .message-forwarded time")).toBeNull();
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
    expect(screen.getByRole("button", { name: "Воспроизвести" })).toHaveClass("media-player-play", "voice-player-play");
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
    changeField(dialog.getByRole("textbox", { name: /Название группы/ }), {
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
    expect(dialog.getByRole("textbox", { name: /Название группы/ })).toHaveTextValue("Команда запуска");
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
    vi.useFakeTimers();
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

    expect(chatActions.remove).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(chatActions.remove).toHaveBeenCalledWith("finance", "aziza");
  });

  it("lets an owner leave while keeping the group for remaining members", async () => {
    vi.useFakeTimers();
    const chatActions = actions();
    vi.mocked(chatActions.remove).mockResolvedValue(undefined);
    renderMessenger({ chats: [{ ...initialChats[0]!, canDelete: true }], chatActions });

    openChatMenu("finance");
    fireEvent.click(screen.getByRole("menuitem", { name: "Выйти из группы" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Выйти из группы?" })).getByRole("button", { name: "Выйти" }));

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(chatActions.remove).toHaveBeenCalledWith("finance", "aziza");
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
    expect(within(buckets).getByRole("button", { name: "Чаты задач" })).toHaveTextContent(/^Чаты задач$/);
    expect(within(buckets).getByRole("button", { name: "Архив" })).toHaveTextContent(/^Архив$/);
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
