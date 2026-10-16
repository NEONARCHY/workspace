import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderedReactionsForUser, ReactionPicker, reactionEmojis } from "./ReactionPicker";
import { reactionAnimatedUrl, reactionCatalog, reactionImageUrl, reactionStillUrl } from "./reaction-catalog";

describe("ReactionPicker", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the complete catalog and promotes an emoji after its first use", () => {
    const onSelect = vi.fn();
    render(<ReactionPicker userId="user-one" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    const menu = screen.getByLabelText("Выберите реакцию");
    expect(menu.querySelectorAll('.reaction-picker-cells button')).toHaveLength(reactionEmojis.length);
    expect([...menu.querySelectorAll('.reaction-picker-cells img')].every(image => image.getAttribute("loading") === "eager")).toBe(true);
    fireEvent.click(within(menu).getByRole("button", { name: "🐇" }));
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

  it("has searchable local artwork for every allowed reaction, preferring native animations", () => {
    expect(reactionCatalog.map((item) => item.emoji).sort()).toEqual([...reactionEmojis].sort());
    expect(new Set(reactionCatalog.map((item) => item.emoji)).size).toBe(reactionEmojis.length);
    expect(reactionImageUrl("❤️")).toBe("/emoji/twemoji/2764.svg");
    expect(reactionAnimatedUrl("❤️")).toBe("/emoji/noto/2764.webp");
    expect(reactionStillUrl("❤️")).toBe("/emoji/noto/2764-still.webp");
    expect(reactionCatalog.filter(item => reactionAnimatedUrl(item.emoji))).toHaveLength(115);
    expect(reactionCatalog.every((item) => Boolean(item.label))).toBe(true);
  });

  it("filters categories and searches across them, with an empty state", () => {
    render(<ReactionPicker userId="user-one" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    fireEvent.click(screen.getByRole("button", { name: "Животные" }));
    expect(screen.getByRole("button", { name: "🐇" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "👍" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск эмодзи" }), { target: { value: "сердце" } });
    expect(screen.getByRole("button", { name: "❤️" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "🐇" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск эмодзи" }), { target: { value: "неизвестный" } });
    expect(screen.getByRole("status")).toHaveTextContent("Эмодзи не найдены");
    fireEvent.click(screen.getByRole("button", { name: "Все эмодзи" }));
    expect(screen.getByRole("textbox", { name: "Поиск эмодзи" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "👍" })).toBeInTheDocument();
  });

  it("marks active reactions, supports grid arrows and closes on selection", () => {
    const onSelect = vi.fn();
    render(<ReactionPicker userId="user-one" active={["😄"]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    const first = screen.getByRole("button", { name: "😄" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "😔" })).toHaveFocus();
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith("😄");
    expect(screen.queryByLabelText("Выберите реакцию")).not.toBeInTheDocument();
  });

  it("reloads frequent reactions when the employee changes and ignores corrupt usage", () => {
    localStorage.setItem("yuksalish:reaction-usage:one", JSON.stringify({ "🐇": { count: 3, lastUsed: 2 } }));
    localStorage.setItem("yuksalish:reaction-usage:two", JSON.stringify({ "🐇": null, "👍": { count: "bad", lastUsed: 1 } }));
    const view = render(<ReactionPicker userId="one" onSelect={vi.fn()} />);
    view.rerender(<ReactionPicker userId="two" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    fireEvent.click(screen.getByRole("button", { name: "Частые" }));
    expect(document.querySelector('.reaction-picker-cells button')).toHaveAttribute("aria-label", "👍");
  });

  it("offers seven frequent quick reactions with shared history and keyboard navigation", () => {
    localStorage.setItem("yuksalish:reaction-usage:user-one", JSON.stringify({ "🐇": { count: 3, lastUsed: 2 } }));
    const onSelect = vi.fn();
    render(<ReactionPicker userId="user-one" variant="context" active={["🐇"]} onSelect={onSelect} />);
    const strip = screen.getByRole("group", { name: "Быстрые реакции" });
    const buttons = within(strip).getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons[0]).toHaveAttribute("aria-label", "🐇");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: "End" });
    expect(within(strip).getByRole("button", { name: "Все реакции" })).toHaveFocus();
    fireEvent.keyDown(buttons[7]!, { key: "Home" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.click(within(strip).getByRole("button", { name: "👍" }));
    expect(onSelect).toHaveBeenCalledWith("👍");
    expect(orderedReactionsForUser("user-one")[1]).toBe("👍");
    expect(orderedReactionsForUser("another-user")[0]).toBe("👍");
  });

  it("expands the full searchable catalog separately from the quick strip", () => {
    const onSelect = vi.fn(), outside = vi.fn();
    render(<div onPointerDown={outside}><ReactionPicker userId="user-one" variant="context" onSelect={onSelect} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Все реакции" }));
    const catalog = screen.getByLabelText("Выберите реакцию");
    expect(catalog.querySelectorAll(".reaction-picker-cells button")).toHaveLength(reactionEmojis.length);
    fireEvent.pointerDown(within(catalog).getByRole("textbox", { name: "Поиск эмодзи" }));
    expect(outside).not.toHaveBeenCalled();
    fireEvent.change(within(catalog).getByRole("textbox", { name: "Поиск эмодзи" }), { target: { value: "кролик" } });
    fireEvent.click(within(catalog).getByRole("button", { name: "🐇" }));
    expect(onSelect).toHaveBeenCalledWith("🐇");
    expect(screen.queryByLabelText("Выберите реакцию")).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Быстрые реакции" })).getAllByRole("button")[0]).toHaveAttribute("aria-label", "🐇");
  });

  it("disables both quick reactions and expansion without permission", () => {
    render(<ReactionPicker userId="user-one" variant="context" disabled onSelect={vi.fn()} />);
    expect(within(screen.getByRole("group", { name: "Быстрые реакции" })).getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("does not open when disabled", () => {
    render(<ReactionPicker userId="user-one" disabled onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    expect(screen.queryByLabelText("Выберите реакцию")).not.toBeInTheDocument();
  });
});
