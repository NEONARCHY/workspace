import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AIReferentGooeySearch } from "./AIReferentGooeySearch";

describe("AI Referent gooey search", () => {
  afterEach(cleanup);

  it("expands on focus and preserves accessible controlled input behavior", () => {
    const { container, rerender } = render(
      <AIReferentGooeySearch
        ariaLabel="Поиск писем"
        onValueChange={(value) => rerender(
          <AIReferentGooeySearch
            ariaLabel="Поиск писем"
            onValueChange={() => undefined}
            placeholder="Номер или тема"
            value={value}
          />
        )}
        placeholder="Номер или тема"
        value=""
      />,
    );

    const root = container.querySelector(".ai-gooey-search");
    expect(root).toHaveAttribute("data-expanded", "false");
    expect(root).toHaveAttribute("data-has-value", "false");
    const visualPlaceholder = container.querySelector(".ai-gooey-search-placeholder");
    expect(visualPlaceholder).toHaveTextContent("Номер или тема");

    fireEvent.click(screen.getByRole("button", { name: "Открыть: поиск писем" }));
    expect(root).toHaveAttribute("data-expanded", "true");
    expect(container.querySelector(".ai-gooey-search-placeholder")).toBe(visualPlaceholder);
    const input = screen.getByRole("textbox", { name: "Поиск писем" });
    fireEvent.change(input, { target: { value: "042" } });
    expect(screen.getByRole("textbox", { name: "Поиск писем" })).toHaveValue("042");
    expect(root).toHaveAttribute("data-has-value", "true");
  });

  it("stays expanded while a query is present", () => {
    const { container } = render(
      <AIReferentGooeySearch
        ariaLabel="Поиск писем"
        onValueChange={() => undefined}
        placeholder="Номер или тема"
        value="проект"
      />,
    );

    expect(container.querySelector(".ai-gooey-search")).toHaveAttribute("data-expanded", "true");
  });

  it("keeps one field width and moves the field and placeholder together", () => {
    const { container } = render(
      <AIReferentGooeySearch
        ariaLabel="Поиск писем"
        collapsedWidth={320}
        expandedOffset={48}
        onValueChange={() => undefined}
        placeholder="Номер или тема"
        value=""
      />,
    );

    const root = container.querySelector<HTMLElement>(".ai-gooey-search");
    expect(root?.style.getPropertyValue("--ai-gooey-collapsed")).toBe("320px");
    expect(root?.style.getPropertyValue("--ai-gooey-offset")).toBe("48px");

    const css = readFileSync(
      resolve(process.cwd(), "src/renderer/ai-referent-workspace.css"),
      "utf8",
    );
    expect(css).not.toContain("--ai-gooey-expanded");
    expect(css).toContain(
      '.ai-gooey-search[data-expanded="true"] .ai-gooey-search-placeholder {\n  transform: translateX(var(--ai-gooey-offset));',
    );
    expect(css).toContain(
      '.ai-gooey-search[data-expanded="true"] .ai-gooey-search-row {\n  transform: translateX(var(--ai-gooey-offset));',
    );
    expect(css).toContain(
      '.ai-referent-view .ai-referent-toolbar > .ai-gooey-search[data-expanded="true"] + .ai-referent-toolbar-actions {\n  transform: translateX(var(--ai-toolbar-search-shift));',
    );
    expect(css).not.toContain("width 520ms");
  });
});
