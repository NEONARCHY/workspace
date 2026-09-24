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
});
