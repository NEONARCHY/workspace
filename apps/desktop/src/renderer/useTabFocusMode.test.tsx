import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTabFocusMode } from "./useTabFocusMode";

function Consumer() { useTabFocusMode(); return <button>Действие</button>; }
const enabled = () => document.documentElement.hasAttribute("data-workspace-tab-focus");
afterEach(cleanup);
describe("Tab-only visible focus", () => {
  it("ignores modifiers, typing, pointer and programmatic focus until Tab", () => {
    const view = render(<Consumer />);
    view.getByRole("button").focus();
    for (const key of ["Shift", "Meta", "Control", "Alt", "a"]) fireEvent.keyDown(document, { key });
    expect(enabled()).toBe(false);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(enabled()).toBe(true);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(enabled()).toBe(true);
    fireEvent.pointerDown(document);
    expect(enabled()).toBe(false);
  });
  it("ignores system shortcuts and clears on window blur or Win", () => {
    render(<Consumer />);
    fireEvent.keyDown(document, { key: "Tab", altKey: true });
    expect(enabled()).toBe(false);
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.keyDown(document, { key: "Meta" });
    expect(enabled()).toBe(false);
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.blur(window);
    expect(enabled()).toBe(false);
  });
  it("shares one lifecycle and releases the listener after the last screen unmounts", () => {
    const first = render(<Consumer />), second = render(<Consumer />);
    first.unmount();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(enabled()).toBe(true);
    second.unmount();
    expect(enabled()).toBe(false);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(enabled()).toBe(false);
  });
});
