import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionJump } from "./SectionJump";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
describe("Workspace command entry", () => {
  it("keeps arrow selection and the fixed hint while navigating a list", () => {
    const onNavigate = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><SectionJump items={[
      { key: "home", label: "Главная", icon: null },
      { key: "tasks", label: "Задачи", icon: null },
      { key: "calendar", label: "Календарь", icon: null },
    ]} onNavigate={onNavigate} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Перейти в раздел" }));
    const search = screen.getByRole("textbox", { name: "Найти раздел" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Календарь/ })).toHaveClass("command-active");
    expect(screen.getByText(/↑ ↓ выбрать/)).toHaveClass("command-hint");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("calendar");
  });
  it("finds real task commands and opens the keyboard selection", () => {
    const onSelect = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><SectionJump items={[{ key: "tasks", label: "Задачи", icon: null }]} onNavigate={vi.fn()} commands={[{ id: "task:1", label: "Подготовить договор", context: "Задача · Новый офис", icon: null, onSelect }]} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Перейти в раздел" }));
    const search = screen.getByRole("textbox", { name: "Найти раздел" });
    fireEvent.change(search, { target: { value: "договор" } });
    expect(screen.getByRole("button", { name: /Подготовить договор/ })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
