import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { ForwardDialog } from "./ForwardDialog";
import { initialChats } from "./test-fixtures/demo-data";

afterEach(cleanup);
it("keeps the same request ID and search after an uncertain failure", async () => {
  const onForward = vi.fn().mockRejectedValueOnce(new Error("Нет соединения")).mockResolvedValueOnce({ id: "confirmed" });
  const close = vi.fn();
  render(<FluentProvider theme={webLightTheme}><ForwardDialog source={{ kind: "feed", id: "post" }} preview="Новости команды" chats={initialChats} onForward={onForward} onClose={close} /></FluentProvider>);
  const input = screen.getByRole("textbox", { name: "Найти чат для пересылки" });
  fireEvent.change(input, { target: { value: "Бахтиёр" } });
  const target = screen.getByRole("button", { name: /Бахтиёр Самугов/ });
  fireEvent.click(target);
  fireEvent.click(target);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Нет соединения"));
  expect(close).not.toHaveBeenCalled();
  expect(onForward).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue("Бахтиёр");
  fireEvent.click(target);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(onForward.mock.calls[1]).toEqual(onForward.mock.calls[0]);
  expect(onForward.mock.calls[0]).toEqual(["baxtiyor", { kind: "feed", id: "post" }, expect.any(String)]);
});
it("never offers read-only chats or the source chat", () => {
  const first = initialChats[0]!;
  render(<FluentProvider theme={webLightTheme}><ForwardDialog source={{ kind: "message", id: "message" }} preview="Текст" excludeChatId={first.id}
    chats={[first, { ...first, id: "readonly", title: "Только чтение", permissions: { ...first.permissions, sendMessages: false } }]}
    onForward={vi.fn()} onClose={vi.fn()} /></FluentProvider>);
  expect(screen.getByRole("status")).toHaveTextContent("Нет доступных чатов");
  expect(screen.queryByRole("button", { name: /Только чтение/ })).not.toBeInTheDocument();
});
