import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactionPicker, reactionEmojis } from "./ReactionPicker";

describe("ReactionPicker", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the complete catalog and promotes an emoji after its first use", () => {
    const onSelect = vi.fn();
    render(<ReactionPicker userId="user-one" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(reactionEmojis.length);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "🐇" }));
    expect(onSelect).toHaveBeenCalledWith("🐇");

    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    expect(screen.getAllByRole("menuitemcheckbox")[0]).toHaveAccessibleName("🐇");
  });

  it("keeps usage histories separate for different users", () => {
    const view = render(<ReactionPicker userId="first-user" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "🐇" }));
    view.rerender(<ReactionPicker key="second" userId="second-user" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    expect(screen.getAllByRole("menuitemcheckbox")[0]).toHaveAccessibleName("👍");
  });
});
