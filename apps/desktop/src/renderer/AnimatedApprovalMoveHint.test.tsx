import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApprovalMoveHint } from "./ApprovalsView";

describe("ApprovalMoveHint", () => {
  it("immediately replaces the destination after a confirmed stage update", () => {
    const { rerender } = render(<ApprovalMoveHint text="Перетащите → Согласование" />);

    rerender(<ApprovalMoveHint text="Перетащите → Оплата" />);
    expect(screen.queryByText("Перетащите → Согласование")).not.toBeInTheDocument();
    expect(screen.getByText("Перетащите → Оплата")).toHaveClass("approval-move-hint");
    expect(screen.getByText("Перетащите → Оплата")).not.toHaveClass("is-entering", "is-leaving");
  });
});
