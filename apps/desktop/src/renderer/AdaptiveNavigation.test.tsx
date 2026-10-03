import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
