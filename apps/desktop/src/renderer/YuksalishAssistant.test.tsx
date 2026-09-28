import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YuksalishAssistant } from "./YuksalishAssistant";
import { loadAssistantMessages, sendAssistantMessage } from "./workspace-api";

vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({ state }: { state: string }) => <span data-testid={`thinking-${state}`} />,
}));

vi.mock("./workspace-api", () => ({
  loadAssistantMessages: vi.fn(),
  sendAssistantMessage: vi.fn(),
}));

describe("YuksalishAssistant", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([]);
    vi.mocked(sendAssistantMessage).mockReset();
  });

  it("opens globally, switches model and keeps a real answer in the stream", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      id: "reply-1", role: "assistant", model: "pro",
      content: "Ваши задачи проверены.", createdAt: "2026-09-28T10:00:00Z",
    });
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("С чего начнём?");
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
    expect(sendAssistantMessage).toHaveBeenCalledWith("test-token", "pro", "Какие у меня задачи?", undefined);
    expect(screen.queryByText(/Gemini/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть окно" }));
    expect(screen.getByRole("button", { name: "Свернуть окно" })).toBeInTheDocument();
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
      undefined,
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
    ));
    expect(document.querySelector(".assistant-message.is-user")).toHaveTextContent("letter.pdf");
  });

  it("keeps request templates available after the first conversation", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "older", role: "assistant", model: "flash-lite", content: "Здравствуйте.",
      createdAt: "2026-09-28T09:00:00Z",
    }]);
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Здравствуйте.");
    fireEvent.click(screen.getByRole("button", { name: /Шаблоны запросов/ }));
    fireEvent.click(screen.getByRole("button", { name: "О сотруднике" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" }).value)
      .toContain("[имя]");
  });
});
