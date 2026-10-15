import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { workspaceTheme } from "./workspace-theme";
import { createRef } from "react";

afterEach(cleanup);
describe("WorkspaceNotice", () => {
  it.each(["info", "success", "warning", "error"] as const)("renders %s feedback with a decorative icon and readable content", tone => {
    render(<FluentProvider theme={workspaceTheme}><WorkspaceNotice tone={tone}>Проверочный текст</WorkspaceNotice></FluentProvider>);
    const notice = screen.getByRole(tone === "error" ? "alert" : "status");
    expect(notice).toHaveAttribute("data-tone", tone);
    expect(notice.querySelector(":scope > svg")).toHaveAttribute("aria-hidden", "true");
    expect(notice.querySelector(".workspace-notice-content")).toHaveTextContent("Проверочный текст");
  });
  it("preserves explicit live semantics and actionable controls", () => {
    const retry = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><WorkspaceNotice tone="warning" role="alert" aria-live="assertive"
      actions={<button onClick={retry}>Повторить</button>}>Временно недоступно</WorkspaceNotice></FluentProvider>);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("keeps the error focus target available to form composers", () => {
    const ref = createRef<HTMLDivElement>();
    render(<FluentProvider theme={workspaceTheme}><WorkspaceNotice ref={ref} tabIndex={-1} tone="error">Сохранение не выполнено</WorkspaceNotice></FluentProvider>);
    ref.current?.focus();
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});
