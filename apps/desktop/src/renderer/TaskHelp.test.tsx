import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskHelp } from "./TasksView";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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

  it("anchors in the transformed modal's coordinates and follows its scroll", async () => {
    let anchorTop = 360;
    const rect = (x: number, y: number, width: number, height: number) => new DOMRect(x, y, width, height);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("task-section-help")) return rect(230, anchorTop, 28, 28);
      if (this.classList.contains("task-section-help-surface")) return rect(0, 0, 390, 120);
      if (this.classList.contains("fui-DialogSurface")) return rect(100, 40, 800, 650);
      return rect(0, 0, 1024, 768);
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("task-section-help-surface") ? 390 : this.classList.contains("task-section-help") ? 28 : this.classList.contains("fui-DialogSurface") ? 800 : 1024;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("task-section-help-surface") ? 120 : this.classList.contains("task-section-help") ? 28 : this.classList.contains("fui-DialogSurface") ? 650 : 768;
    });
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
    render(<div className="fui-DialogSurface" role="dialog" style={{ transform: "translateY(0)" }}>
      <div data-testid="scroll" style={{ overflow: "auto" }}><TaskHelp title="Срок">Правила</TaskHelp></div>
    </div>);
    fireEvent.click(screen.getByRole("button", { name: "Справка: Срок" }));
    const note = screen.getByRole("note");
    // Viewport (230, 233), minus the containing block's (100, 40).
    await waitFor(() => expect(note.style.transform).toBe("translate(130px, 193px)"));
    anchorTop = 300;
    fireEvent.scroll(screen.getByTestId("scroll"));
    await waitFor(() => expect(note.style.transform).toBe("translate(130px, 133px)"));
    anchorTop = 60;
    fireEvent(window, new Event("resize"));
    // Insufficient room above: flip below the question mark, not away from it.
    await waitFor(() => expect(note).toHaveAttribute("data-popper-placement", "bottom-start"));
    expect(note.style.transform).toBe("translate(130px, 55px)");
  });
});
