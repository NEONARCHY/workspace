import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceCaret } from "./CaretGlow";

describe("WorkspaceCaret", () => {
  it("tracks a collapsed text selection and restores the native caret on blur", async () => {
    const { container } = render(<><input aria-label="Рабочее поле" defaultValue="Текст" /><WorkspaceCaret /></>);
    const input = container.querySelector("input")!;
    Object.defineProperty(input, "clientWidth", { configurable: true, value: 240 });
    input.getBoundingClientRect = () => ({
      x: 100, y: 80, left: 100, top: 80, right: 340, bottom: 120,
      width: 240, height: 40, toJSON: () => ({}),
    });
    input.focus();
    input.setSelectionRange(5, 5);
    fireEvent.input(input);

    await waitFor(() => expect(input).toHaveClass("ws-caret-managed"));
    await waitFor(() => expect(container.querySelector(".ws-caret-line")).toHaveClass("is-visible"));

    fireEvent.blur(input);
    expect(input).not.toHaveClass("ws-caret-managed");
    expect(container.querySelector(".ws-caret-line")).not.toHaveClass("is-visible");
  });
});
