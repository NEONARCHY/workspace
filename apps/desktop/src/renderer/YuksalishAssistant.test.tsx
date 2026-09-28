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
    fireEvent.change(screen.getByLabelText("Режим"), { target: { value: "pro" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), {
      target: { value: "Какие у меня задачи?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(document.querySelector(".assistant-message.is-assistant"))
      .toHaveTextContent("Ваши задачи проверены."));
    expect(sendAssistantMessage).toHaveBeenCalledWith("test-token", "pro", "Какие у меня задачи?");
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
});
