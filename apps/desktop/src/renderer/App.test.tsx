import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

describe("corporate workspace alpha", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens in messenger and sends a local test message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);

    await waitFor(() => expect(screen.getByText("Демонстрационный режим")).toBeInTheDocument());
    const composer = screen.getByRole("textbox", { name: "Новое сообщение" });
    fireEvent.change(composer, { target: { value: "Заявку подготовила" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    expect(screen.getByText("Заявку подготовила")).toBeInTheDocument();
  });

  it("creates a task inside the same application shell", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая задача" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Проверить новый маршрут оплаты" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(screen.getAllByText("Проверить новый маршрут оплаты").length).toBeGreaterThan(0);
  });
});
