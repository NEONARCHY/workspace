import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YuksalishAssistant } from "./YuksalishAssistant";
import { listAssistantChats, loadAssistantMessages, sendAssistantMessage } from "./workspace-api";

vi.mock("thinking-orbs", () => ({ ThinkingOrb: () => <span /> }));
vi.mock("./workspace-api", () => ({
  listAssistantChats: vi.fn(), loadAssistantMessages: vi.fn(), sendAssistantMessage: vi.fn(),
  createAssistantChat: vi.fn(), deleteAssistantChat: vi.fn(), pinAssistantChat: vi.fn(),
}));
const chat = { id: "chat", title: "Рабочие вопросы", isDefault: true,
  createdAt: "2026-11-26T08:00:00Z", updatedAt: "2026-11-26T08:00:00Z" };
beforeEach(() => {
  vi.mocked(listAssistantChats).mockResolvedValue([chat]);
  vi.mocked(loadAssistantMessages).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("stationary assistant launcher", () => {
  it("opens a usable loading window immediately and stops its read chain when closed", async () => {
    let finish!: (value: typeof chat[]) => void;
    vi.mocked(listAssistantChats).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<YuksalishAssistant token="test" />);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    const orb = launcher.querySelector(".gradient-orb-fallback");
    expect(orb).not.toBeNull();
    expect(listAssistantChats).not.toHaveBeenCalled();
    fireEvent.click(launcher);
    const dialog = screen.getByRole("dialog", { name: "Ассистент Yuksalish" });
    expect(dialog).not.toHaveAttribute("inert");
    expect(launcher).toBeEnabled();
    expect(launcher).toHaveAttribute("aria-busy", "true");
    expect(launcher.querySelector(".gradient-orb-fallback")).toBe(orb);
    fireEvent.click(launcher);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => finish([chat]));
    expect(loadAssistantMessages).not.toHaveBeenCalled();
    expect(launcher.querySelector(".gradient-orb-fallback")).toBe(orb);
    expect(launcher).toHaveFocus();
  });

  it.each([false, true])("keeps the same visible orb through expansion and reopening (history=%s)", async history => {
    if (history) vi.mocked(loadAssistantMessages).mockResolvedValue([{ id: "message", role: "assistant", model: "flash-lite",
      content: "Сохранённая переписка", createdAt: chat.createdAt }]);
    render(<YuksalishAssistant token="test" />);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    const orb = launcher.querySelector(".gradient-orb-fallback");
    fireEvent.click(launcher);
    await screen.findByText(history ? "Сохранённая переписка" : "С чего начнём?");
    const input = screen.getByRole("textbox", { name: "Сообщение ассистенту" });
    fireEvent.change(input, { target: { value: "Мой черновик" } });
    fireEvent.click(screen.getByRole("button", { name: "Развернуть окно" }));
    expect(launcher.querySelector(".gradient-orb-fallback")).toBe(orb);
    expect(document.querySelectorAll(".gradient-orb-fallback")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(launcher).toHaveFocus();
    fireEvent.click(launcher);
    expect(screen.getByRole("textbox", { name: "Сообщение ассистенту" })).toHaveValue("Мой черновик");
    expect(launcher.querySelector(".gradient-orb-fallback")).toBe(orb);
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });

  it("keeps the launcher usable after a history error and retries on reopening", async () => {
    vi.mocked(listAssistantChats).mockRejectedValueOnce(new Error("Источник недоступен"));
    render(<YuksalishAssistant token="test" />);
    const launcher = screen.getByRole("button", { name: "Открыть ассистента Yuksalish" });
    const orb = launcher.querySelector(".gradient-orb-fallback");
    fireEvent.click(launcher);
    await screen.findByText("Не удалось загрузить историю. Закройте и откройте ассистента ещё раз.");
    expect(launcher).toBeEnabled();
    expect(launcher).toHaveAttribute("aria-busy", "false");
    fireEvent.click(launcher);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(launcher);
    await screen.findByText("С чего начнём?");
    expect(launcher.querySelector(".gradient-orb-fallback")).toBe(orb);
  });
});
