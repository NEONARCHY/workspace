import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserNavigation } from "./BrowserNavigation";
import { workspaceTheme } from "./workspace-theme";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Fixture({ compact = true }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <FluentProvider theme={workspaceTheme}>
    <button ref={trigger} aria-expanded={open} onClick={() => setOpen(true)}>Открыть меню</button>
    <BrowserNavigation compact={compact} open={open} returnFocusRef={trigger} onOpenChange={setOpen}>
      <aside aria-label="Основная навигация"><button onClick={() => setOpen(false)}>Закрыть меню</button><button onClick={() => setOpen(false)}>Задачи</button></aside>
    </BrowserNavigation>
    <label>Черновик<input defaultValue="Сохранённый ввод" /></label>
  </FluentProvider>;
}

it("opens a labelled modal, closes on selection, and preserves the work area", async () => {
  render(<Fixture />);
  const input = screen.getByRole("textbox", { name: "Черновик" });
  fireEvent.change(input, { target: { value: "Мой несохранённый текст" } });
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Открыть меню" }));
  expect(screen.getByRole("dialog", { name: "Меню разделов" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "Открыть меню" })).toHaveFocus());
  expect(screen.getByRole("textbox", { name: "Черновик" })).toBe(input);
  expect(input).toHaveValue("Мой несохранённый текст");
});

it("keeps desktop navigation inline and resets an open drawer at the breakpoint", async () => {
  const view = render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Открыть меню" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<Fixture compact={false} />);
  expect(screen.getByRole("complementary", { name: "Основная навигация" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Открыть меню" })).toHaveAttribute("aria-expanded", "false"));
  view.rerender(<Fixture />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
