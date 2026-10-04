import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdaptiveNavigation } from "./AdaptiveNavigation";

const items = [
  { key: "one", label: "Первый" },
  { key: "two", label: "Второй" },
  { key: "three", label: "Третий" },
];

describe("AdaptiveNavigation overflow", () => {
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  });

  it("stays open for a click inside and closes for a click anywhere outside", () => {
    render(<>
      <AdaptiveNavigation items={items} renderItem={(item) => <button key={item.key} className="rail-action" type="button">{item.label}</button>} />
      <button type="button">Внешняя кнопка</button>
    </>);
    const more = screen.getByRole("button", { name: "Ещё, 2 разделов" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const drawer = screen.getByRole("complementary", { name: "Другие разделы" });
    expect(drawer.closest(".rail-nav")).toBeNull();
    expect(drawer.parentElement).toHaveAttribute("data-portal-node", "true");

    fireEvent.pointerDown(screen.getByRole("complementary", { name: "Другие разделы" }));
    expect(more).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Внешняя кнопка" }));
    expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("moves trailing entries to More while keeping the expanded group mounted", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 250 });
    const entries = [...items, { key: "four", label: "Четвёртый" }, { key: "five", label: "Пятый" }];
    const renderItem = (item: typeof entries[number]) => <button key={item.key} className="rail-action">{item.label}</button>;
    const view = render(<AdaptiveNavigation items={entries} renderItem={renderItem} />);
    const group = screen.getByRole("button", { name: "Второй" });
    expect(screen.queryByRole("button", { name: /Ещё/ })).not.toBeInTheDocument();
    view.rerender(<AdaptiveNavigation items={entries} expandedItem={{ key: "two", height: 100 }} renderItem={renderItem} />);
    expect(screen.getByRole("button", { name: "Второй" })).toBe(group);
    expect(screen.getByRole("button", { name: "Ещё, 3 разделов" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Третий" })).not.toBeInTheDocument();
    view.rerender(<AdaptiveNavigation items={entries} renderItem={renderItem} />);
    expect(screen.getByRole("button", { name: "Пятый" })).toBeInTheDocument();
  });

  it("closes on a visible section and Escape returns focus to More", () => {
    render(<AdaptiveNavigation items={items} renderItem={(item) => <button key={item.key} className="rail-action" type="button">{item.label}</button>} />);
    const more = screen.getByRole("button", { name: "Ещё, 2 разделов" });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("button", { name: "Первый" }));
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
  });
  it("keeps portalled entries clickable and closes after selecting one", () => {
    const select = vi.fn();
    render(<AdaptiveNavigation items={items} renderItem={(item, overflow, close) => <button key={item.key} className="rail-action" onClick={() => { select(item.key, overflow); close(); }}>{item.label}</button>} />);
    const more = screen.getByRole("button", { name: "Ещё, 2 разделов" });
    fireEvent.click(more);
    const entry = screen.getByRole("button", { name: "Второй" });
    fireEvent.pointerDown(entry);
    expect(more).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(entry);
    expect(select).toHaveBeenCalledWith("two", true);
    expect(more).toHaveAttribute("aria-expanded", "false");
  });
  it("reserves More using the actual taller collapsed button height", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(48);
    render(<AdaptiveNavigation items={items} renderItem={(item) => <button key={item.key} className="rail-action">{item.label}</button>} />);
    expect(screen.getByRole("button", { name: "Ещё, 3 разделов" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Первый" })).not.toBeInTheDocument();
  });
  it.each([[153, true], [154, false]])("fits the precise row/gap boundary at %i px", (height, overflow) => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(48);
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => height });
    render(<AdaptiveNavigation items={items} renderItem={(item) => <button key={item.key} className="rail-action">{item.label}</button>} />);
    expect(Boolean(screen.queryByRole("button", { name: /Ещё/ }))).toBe(overflow);
  });
});
