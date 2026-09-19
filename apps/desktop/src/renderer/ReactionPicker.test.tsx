import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderedReactionsForUser, ReactionPicker, reactionEmojis } from "./ReactionPicker";

describe("ReactionPicker", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the complete catalog and promotes an emoji after its first use", () => {
    const onSelect = vi.fn();
    render(<ReactionPicker userId="user-one" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    const menu = screen.getByLabelText("Выберите реакцию");
    expect(menu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(reactionEmojis.length);
    fireEvent.click(menu.querySelector('[role="menuitemcheckbox"][aria-label="🐇"]')!);
    expect(onSelect).toHaveBeenCalledWith("🐇");

    expect(orderedReactionsForUser("user-one")[0]).toBe("🐇");
  });

  it("keeps usage histories separate for different users", () => {
    localStorage.setItem("yuksalish:reaction-usage:first-user", JSON.stringify({
      "🐇": { count: 1, lastUsed: 1 },
    }));
    expect(orderedReactionsForUser("first-user")[0]).toBe("🐇");
    expect(orderedReactionsForUser("second-user")[0]).toBe("👍");
  });
});
