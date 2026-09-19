import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnimatedApprovalMoveHint } from "./ApprovalsView";

describe("AnimatedApprovalMoveHint", () => {
  afterEach(() => vi.useRealTimers());

  it("softly replaces the destination after a confirmed stage update", () => {
    vi.useFakeTimers();
    const { rerender } = render(<AnimatedApprovalMoveHint text="Перетащите → Согласование" />);

    rerender(<AnimatedApprovalMoveHint text="Перетащите → Оплата" />);
    expect(screen.getByText("Перетащите → Согласование")).toHaveClass("is-leaving");

    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByText("Перетащите → Оплата")).toHaveClass("is-entering");

    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByText("Перетащите → Оплата")).not.toHaveClass("is-entering");
  });
});
