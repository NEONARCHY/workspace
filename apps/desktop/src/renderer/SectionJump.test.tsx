import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionJump } from "./SectionJump";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
describe("Workspace command entry", () => {
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
