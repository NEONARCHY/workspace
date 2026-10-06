import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskHelp } from "./TasksView";

afterEach(cleanup);
describe("Task section help", () => {
  it("keeps the explanation inside its modal layer and closes with Escape", () => {
    render(<div className="fui-DialogSurface" role="dialog"><TaskHelp title="Как учитывается срок">Объяснение расчёта срока</TaskHelp></div>);
    const button = screen.getByRole("button", { name: "Справка: Как учитывается срок" });
    fireEvent.click(button);
    const note = screen.getByRole("note");
    expect(screen.getByRole("dialog")).toContainElement(note);
    expect(note).toHaveTextContent("Объяснение расчёта срока");
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("note")).toBeNull();
    expect(button).toHaveFocus();
  });
  it("also opens outside a modal and closes with a second click", () => {
    render(<TaskHelp title="Срок">Правила</TaskHelp>);
    const button = screen.getByRole("button", { name: "Справка: Срок" });
    fireEvent.click(button);
    expect(screen.getByRole("note")).toHaveTextContent("Правила");
    fireEvent.click(button);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
