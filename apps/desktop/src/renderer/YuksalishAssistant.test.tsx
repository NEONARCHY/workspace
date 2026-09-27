import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YuksalishAssistant } from "./YuksalishAssistant";
import { loadAssistantMessages, sendAssistantMessage } from "./workspace-api";

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
    fireEvent.change(screen.getByLabelText("Модель"), { target: { value: "pro" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), {
      target: { value: "Какие у меня задачи?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await screen.findByText("Ваши задачи проверены.");
    expect(sendAssistantMessage).toHaveBeenCalledWith("test-token", "pro", "Какие у меня задачи?");
  });

  it("preserves the draft when the server rejects the request", async () => {
    vi.mocked(sendAssistantMessage).mockRejectedValue(new Error("Ключ Gemini пока не настроен"));
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
});
