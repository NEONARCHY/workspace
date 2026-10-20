import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { initialChats } from "./test-fixtures/demo-data";
import { changeField } from "./test-fixtures/rich-editor";
import { render, response, mockServer, loginToWorkspace } from "./app-test-harness";

describe("corporate workspace authentication alpha", () => {
  it("keeps the floating messenger and draft across pages and its full-section handoff", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "home");
    fireEvent.click(screen.getByRole("button", { name: "Открыть мини-мессенджер" }));
    const mini = await screen.findByRole("dialog", { name: "Мини-мессенджер" });
    fireEvent.click(within(mini).getByRole("button", { name: /^Финансы и закупки/ }));
    const editor = await within(mini).findByRole("textbox", { name: "Новое сообщение" });
    changeField(editor, { target: { value: "Общий черновик" } });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /^Задачи/ }));
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveTextContent("Общий черновик");
    fireEvent.click(screen.getByRole("button", { name: "Открыть полный мессенджер" }));
    await screen.findByRole("region", { name: "Раздел мессенджера" });
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBe(editor);
    expect(screen.queryByRole("button", { name: "Открыть мини-мессенджер" })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /^Задачи/ }));
    await screen.findByRole("button", { name: "Открыть мини-мессенджер" });
    fireEvent.click(screen.getByRole("button", { name: "Открыть мини-мессенджер" }));
    await screen.findByRole("dialog", { name: "Мини-мессенджер" });
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBe(editor);
  });

  it("logs in and sends a server-backed message", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    const composer = screen.getByRole("textbox", { name: "Новое сообщение" });
    changeField(composer, { target: { value: "Заявку подготовила" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    expect(await screen.findByText("Заявку подготовила")).toBeInTheDocument();
  });

  it("keeps an acknowledged send visible when an older background response arrives later", async () => {
    const fetchMock = mockServer();
    const server = fetchMock.getMockImplementation()!;
    render(<App />);
    await loginToWorkspace();
    let releaseOld!: (response: Response) => void;
    let releaseFresh!: (response: Response) => void;
    let stale: Response | undefined;
    let fresh: Response | undefined;
    let requests = 0;
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith("/workspace/bootstrap")) {
        const captured = await server(input, options);
        requests++;
        if (requests === 1) { stale = captured; return new Promise<Response>((done) => { releaseOld = done; }); }
        if (requests === 2) { fresh = captured; return new Promise<Response>((done) => { releaseFresh = done; }); }
        return captured;
      }
      return server(input, options);
    });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(stale).toBeDefined());
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Не пропадаю после подтверждения" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(document.querySelector('[data-message-id="server-message"]')).toHaveTextContent("Не пропадаю после подтверждения"));
    await act(async () => releaseOld(stale!));
    await waitFor(() => expect(fresh).toBeDefined());
    expect(document.querySelector('[data-message-id="server-message"]')).toHaveTextContent("Не пропадаю после подтверждения");
    await act(async () => releaseFresh(fresh!));
    expect(document.querySelectorAll('[data-message-id="server-message"]')).toHaveLength(1);
    expect(document.querySelector('[data-message-id="server-message"]')).toHaveTextContent("Не пропадаю после подтверждения");
  });

  it.each(["online", "focus"])("refreshes incoming messages after %s without a websocket event", async (eventName) => {
    const fetchMock = mockServer();
    const server = fetchMock.getMockImplementation()!;
    render(<App />);
    await loginToWorkspace();
    fetchMock.mockImplementation(async (input, options) => {
      const result = await server(input, options);
      if (!String(input).endsWith("/workspace/bootstrap")) return result;
      const snapshot = await result.json();
      return response({ ...snapshot, messages: [...snapshot.messages, {
        id: "recovered-incoming", chatId: initialChats[0]!.id, authorId: "dilshod", body: "Догрузилось без перезахода", time: "12:01",
      }] });
    });
    fireEvent(window, new Event(eventName));
    expect(await screen.findByText("Догрузилось без перезахода")).toBeInTheDocument();
  });

  it("uploads a real attachment with a new message", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    const file = new File(["invoice"], "invoice.txt", { type: "text/plain" });
    changeField(screen.getByLabelText("Файлы сообщения"), {
      target: { files: [file] },
    });
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), {
      target: { value: "Счёт приложен" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/attachments/message/server-message"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    expect(await screen.findByText("invoice.txt")).toBeInTheDocument();
  });

  it("creates a linked task directly from a message", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.contextMenu(document.querySelector(".message")!);
    fireEvent.click(screen.getByRole("button", { name: "В задачу" }));
    expect(screen.getByRole("dialog", { name: "Новая задача" })).toBeInTheDocument();
    changeField(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Проверить счёт из переписки" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить задачу" }));

    // A cold worker must mount the destination section before its notice is visible.
    expect(await screen.findByText("Создана из сообщения · связь сохранена", {}, { timeout: 5_000 })).toBeInTheDocument();
    const closeNotice = screen.queryByRole("button", { name: "Закрыть уведомление" });
    if (closeNotice) fireEvent.click(closeNotice);
    await waitFor(
      () => {
        expect(screen.queryByText("Создана из сообщения · связь сохранена")).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
    expect(screen.queryByRole("dialog", { name: "Новая задача" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Проверить счёт из переписки").length).toBeGreaterThan(0);
  });
});
