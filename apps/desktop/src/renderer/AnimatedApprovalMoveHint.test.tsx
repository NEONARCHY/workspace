import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnimatedApprovalMoveHint } from "./ApprovalsView";

describe("AnimatedApprovalMoveHint", () => {
  afterEach(() => vi.useRealTimers());

  it("softly replaces the destination after a confirmed stage update", () => {
    vi.useFakeTimers();
    const { rerender } = render(<AnimatedApprovalMoveHint requestId="request-1" text="Перетащите → Согласование" />);

    rerender(<AnimatedApprovalMoveHint requestId="request-1" text="Перетащите → Оплата" />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText("Перетащите → Согласование")).toHaveClass("is-leaving");

    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByText("Перетащите → Оплата")).toHaveClass("is-entering");

    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByText("Перетащите → Оплата")).not.toHaveClass("is-entering");
  });

  it("preserves the previous hint while a card remounts in its new lane", () => {
    vi.useFakeTimers();
    const first = render(
      <AnimatedApprovalMoveHint requestId="request-remounted" text="Перетащите → Руководитель" />,
    );
    first.unmount();

    render(<AnimatedApprovalMoveHint requestId="request-remounted" text="Перетащите → Бухгалтер" />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText("Перетащите → Руководитель")).toHaveClass("is-leaving");

    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByText("Перетащите → Бухгалтер")).toHaveClass("is-entering");
  });
});
