import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIReferentGooeySearch } from "./AIReferentGooeySearch";

describe("AI Referent shared search", () => {
  afterEach(cleanup);
  it("has exactly one placeholder and expands the real field on focus", () => {
    const onValueChange = vi.fn();
    const { container } = render(<AIReferentGooeySearch ariaLabel="Поиск писем" onValueChange={onValueChange} placeholder="Номер или тема" value="" />);
    const input = screen.getByRole("textbox", { name: "Поиск писем" });
    expect(container.querySelectorAll('[placeholder="Номер или тема"]')).toHaveLength(1);
    expect(screen.queryByText("Номер или тема")).not.toBeInTheDocument();
    expect(container.querySelector(".workspace-search")).toHaveAttribute("data-expanded", "false");
    const icon = container.querySelector(".fui-Input__contentBefore");
    fireEvent.focus(input);
    expect(container.querySelector(".fui-Input__contentBefore")).toBe(icon);
    expect(container.querySelector(".workspace-search")).toHaveAttribute("data-expanded", "true");
    fireEvent.change(input, { target: { value: "042" } });
    expect(onValueChange).toHaveBeenCalledWith("042");
    fireEvent.blur(input);
    expect(container.querySelector(".workspace-search")).toHaveAttribute("data-expanded", "false");
  });
  it("keeps a query open and retains configurable layout width", () => {
    const { container } = render(<AIReferentGooeySearch ariaLabel="Поиск писем" collapsedWidth={320} expandedOffset={48} onValueChange={() => undefined} placeholder="Номер или тема" value="проект" />);
    const root = container.querySelector<HTMLElement>(".workspace-search");
    expect(root).toHaveAttribute("data-expanded", "true");
    expect(root?.style.getPropertyValue("--search-width")).toBe("320px");
    expect(root?.style.getPropertyValue("--search-growth")).toBe("48px");
  });
});
