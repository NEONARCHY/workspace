import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIReferentPagination } from "./AIReferentPagination";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);

describe("AIReferentPagination", () => {
  it("keeps named arrow controls and disables the first-page back action", () => {
    const change = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><AIReferentPagination label="Страницы писем"
      page={0} found={260} loading={false} hasNext onPageChange={change} /></FluentProvider>);
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(screen.getByText("Страница 1 · Найдено 260")).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(change).toHaveBeenCalledWith(1);
  });

  it("blocks both directions during loading and next on the last page", () => {
    const change = vi.fn();
    const view = render(<FluentProvider theme={workspaceTheme}><AIReferentPagination label="Страницы писем"
      page={2} loading hasNext onPageChange={change} /></FluentProvider>);
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
    view.rerender(<FluentProvider theme={workspaceTheme}><AIReferentPagination label="Страницы писем"
      page={2} loading={false} hasNext={false} onPageChange={change} /></FluentProvider>);
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(change).toHaveBeenCalledWith(1);
    expect(screen.getByText("Страница 3")).toBeInTheDocument();
  });
});
