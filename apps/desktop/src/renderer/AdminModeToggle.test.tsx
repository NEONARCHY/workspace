import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { AdminModeToggle } from "./AdminModeToggle";
import { workspaceTheme } from "./workspace-theme";
import { setAdministratorMode } from "./workspace-api";

vi.mock("./workspace-api", () => ({ setAdministratorMode: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each([true, false])("changes effective mode from %s and reloads only after success", async enabled => {
  let resolve!: () => void;
  vi.mocked(setAdministratorMode).mockReturnValue(new Promise(done => { resolve = () => done({
    id: "admin", name: "Administrator", initials: "A", color: "blue", role: enabled ? "employee" : "admin",
  }); }));
  const changed = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><AdminModeToggle token="session" enabled={enabled} onChanged={changed} /></FluentProvider>);
  const toggle = screen.getByRole("switch", { name: "Режим администратора" });
  expect(toggle).toHaveAttribute("aria-checked", String(enabled));
  fireEvent.click(toggle); fireEvent.click(toggle);
  expect(setAdministratorMode).toHaveBeenCalledExactlyOnceWith("session", !enabled);
  expect(toggle).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(changed).toHaveBeenCalledOnce();
});

it("keeps the previous state and allows retry after server failure", async () => {
  vi.mocked(setAdministratorMode).mockRejectedValueOnce(new Error("Нет связи"));
  const changed = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><AdminModeToggle token="session" enabled onChanged={changed} /></FluentProvider>);
  const toggle = screen.getByRole("switch");
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveTextContent("Нет связи");
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(changed).not.toHaveBeenCalled();
});
