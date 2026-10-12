import { FluentProvider } from "@fluentui/react-components";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserChatActions } from "./BrowserChatActions";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
it("keeps inline desktop actions and exposes the same action through the compact menu", async () => {
  const action = vi.fn();
  const fixture = (compact: boolean) => <FluentProvider theme={workspaceTheme}><BrowserChatActions compact={compact}>
    <button onClick={action}>Поиск в переписке</button>
  </BrowserChatActions></FluentProvider>;
  const view = render(fixture(false));
  fireEvent.click(screen.getByRole("button", { name: "Поиск в переписке" }));
  expect(action).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Действия переписки" })).not.toBeInTheDocument();
  view.rerender(fixture(true));
  expect(screen.queryByRole("button", { name: "Поиск в переписке" })).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "Действия переписки" });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", { name: "Поиск в переписке" }));
  expect(action).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Поиск в переписке" })).not.toBeInTheDocument());
  fireEvent.click(trigger);
  await screen.findByRole("button", { name: "Поиск в переписке" });
  view.rerender(fixture(false));
  view.rerender(fixture(true));
  expect(screen.queryByRole("button", { name: "Поиск в переписке" })).not.toBeInTheDocument();
});
