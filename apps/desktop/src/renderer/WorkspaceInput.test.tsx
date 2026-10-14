import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "./WorkspaceInput";

describe("shared expandable workspace search", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("preserves refs, keyboard handlers, controlled values and disabled state", () => {
    const ref = createRef<HTMLInputElement>();
    const change = vi.fn(), key = vi.fn();
    const { container, rerender } = render(<Input ref={ref} aria-label="Поиск задач" value="" maxLength={100} onChange={change} onKeyDown={key} />);
    const field = screen.getByRole("textbox", { name: "Поиск задач" });
    expect(ref.current).toBe(field);
    expect(field).toHaveAttribute("maxlength", "100");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(key).toHaveBeenCalled();
    fireEvent.focus(field);
    expect(container.querySelector(".workspace-search")).toHaveAttribute("data-morphing", "true");
    expect(container.querySelector("feGaussianBlur")).toHaveAttribute("stdDeviation", "4");
    expect(container.querySelector("feComposite")).toHaveAttribute("operator", "over");
    expect(container.querySelector("feComposite")).toHaveAttribute("in", "SourceGraphic");
    fireEvent.change(field, { target: { value: "план" } });
    expect(change.mock.calls[0]?.[1]).toEqual({ value: "план" });
    rerender(<Input aria-label="Поиск задач" value="план" disabled />);
    expect(field).toBeDisabled();
    expect(container.querySelector(".workspace-search")).toHaveAttribute("data-expanded", "true");
  });
  it("does not change ordinary form inputs", () => {
    const { container } = render(<Input aria-label="Название проекта" value="Проект" />);
    expect(container.querySelector(".workspace-search")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("Проект");
  });
  it("matches the adjacent control's height", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { height: this.tagName === "BUTTON" ? 40 : 34, width: 100, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}) };
    });
    const { container } = render(<div><Input aria-label="Поиск" /><button>Фильтр</button></div>);
    expect(container.querySelector<HTMLElement>(".workspace-search")?.style.getPropertyValue("--search-height")).toBe("40px");
  });
  it("matches the segmented surface rather than its shorter inset buttons", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const height = this.matches(".sliding-segmented") ? 44 : 34;
      const top = this.matches(".unrelated") ? 100 : 0;
      return { height, width: 100, top, left: 0, right: 100, bottom: top + height, x: 0, y: top, toJSON: () => ({}) };
    });
    const { container } = render(<div><button className="unrelated">Другой ряд</button>
      <div className="sliding-segmented"><button>Канбан</button><button>Список</button></div>
      <Input aria-label="Поиск" /><div className="fui-Dropdown"><button>Все</button></div></div>);
    const search = container.querySelector<HTMLElement>(".workspace-search");
    expect(search?.style.getPropertyValue("--search-height")).toBe("44px");
    fireEvent.focus(screen.getByRole("textbox"));
    expect(search?.style.getPropertyValue("--search-height")).toBe("44px");
  });
  it("uses layout height rather than a temporarily scaled screen rectangle", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.matches(".sliding-segmented") ? 44 : 34;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 34, width: 100, top: 0, left: 0, right: 100, bottom: 34, x: 0, y: 0, toJSON: () => ({}) });
    const { container } = render(<div><div className="sliding-segmented"><button>Канбан</button></div><Input aria-label="Поиск" /></div>);
    expect(container.querySelector<HTMLElement>(".workspace-search")?.style.getPropertyValue("--search-height")).toBe("44px");
  });
  it("reserves real layout width and honours reduced motion, with no text overlays", () => {
    const css = readFileSync(resolve(process.cwd(), "src/renderer/workspace-search.css"), "utf8");
    expect(css).toContain("width: calc(var(--search-width) + var(--search-growth))");
    expect(css).toContain("flex: 0 1 auto");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toContain(".workspace-search-field { position: absolute");
    expect(css).toContain("filter: var(--search-morph-filter)");
    expect(css).toContain(".workspace-search-field::after { display: none; }");
    expect(css).toContain("box-shadow: none;");
    const referentCss = readFileSync(resolve(process.cwd(), "src/renderer/ai-referent-workspace.css"), "utf8");
    expect(referentCss).not.toContain("translateX(var(--ai-toolbar-search-shift))");
  });
});
