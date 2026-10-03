import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YuksalishAssistant } from "./YuksalishAssistant";
import { loadAssistantMessages, sendAssistantMessage, transcribeAssistantVoice } from "./workspace-api";

vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({ state }: { state: string }) => <span data-testid={`thinking-${state}`} />,
}));

vi.mock("./workspace-api", () => ({
  loadAssistantMessages: vi.fn(),
  sendAssistantMessage: vi.fn(),
  transcribeAssistantVoice: vi.fn(),
}));

describe("YuksalishAssistant", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([]);
    vi.mocked(sendAssistantMessage).mockReset();
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
    expect(sendAssistantMessage).toHaveBeenCalledWith("test-token", "pro", "Какие у меня задачи?", undefined, false);
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
      undefined, false,
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
      false,
    ));
    expect(document.querySelector(".assistant-message.is-user")).toHaveTextContent("letter.pdf");
  });

  it("puts a voice request in the composer before the user submits an action", async () => {
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
    vi.mocked(transcribeAssistantVoice).mockResolvedValue({ text: "Создай задачу проверить отчёт" });
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
      fireEvent.click(screen.getByRole("button", { name: "Голосовой ввод" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Слушаю");
      fireEvent.click(screen.getByRole("button", { name: "Остановить запись" }));
      const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" });
      await waitFor(() => expect(input.value).toBe("Создай задачу проверить отчёт"));
      expect(sendAssistantMessage).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
      await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(
        "test-token", "flash-lite", "Создай задачу проверить отчёт", undefined, false,
      ));
      expect(stopTrack).toHaveBeenCalled();
    } finally {
      if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
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
    fireEvent.click(screen.getByRole("button", { name: /Шаблоны запросов/ }));
    fireEvent.click(screen.getByRole("button", { name: "О сотруднике" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Сообщение ассистенту" }).value)
      .toContain("[имя]");
  });

  it("shows stored answer sources without presenting hidden model reasoning", async () => {
    vi.mocked(loadAssistantMessages).mockResolvedValue([{
      id: "sourced", role: "assistant", model: "flash-lite", content: "Сведения о сотруднике.",
      createdAt: "2026-09-28T09:00:00Z", sourceLabels: ["Проверены доступные профили сотрудников"],
    }]);
    render(<YuksalishAssistant token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть ассистента Yuksalish" }));
    await screen.findByText("Сведения о сотруднике.");
    const details = screen.getByText("Как подготовлен ответ").closest("details")!;
    details.open = true;
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Проверены доступные профили сотрудников")).toBeInTheDocument();
    expect(screen.getByText(/не скрытые рассуждения модели/)).toBeInTheDocument();
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
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение ассистенту" }), {
      target: { value: "Добавь описание" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(
      "test-token", "flash-lite", "Добавь описание", undefined, true,
    ));
    fireEvent.click((await screen.findAllByRole("button", { name: "Открыть заполненную форму" }))[0]!);
    expect(onPrepareAction).toHaveBeenCalledWith(draft);
    expect(screen.getByRole("dialog", { name: "Ассистент Yuksalish" })).toBeInTheDocument();
  });
});
