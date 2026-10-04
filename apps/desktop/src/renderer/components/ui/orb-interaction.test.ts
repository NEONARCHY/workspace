import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachOrbInteraction } from "./orb-interaction";

describe("orb interaction intent", () => {
  let button: HTMLButtonElement;
  let target: { current: number };
  let detach: () => void;
  beforeEach(() => {
    button = document.createElement("button");
    document.body.append(button);
    button.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 48, bottom: 48, width: 48, height: 48, toJSON: () => ({}) });
    target = { current: 0 };
    detach = attachOrbInteraction(button, button, target);
  });
  afterEach(() => { detach(); button.remove(); });
  it("does not treat restored/programmatic focus as hover", () => {
    button.focus();
    expect(target.current).toBe(0);
    fireEvent.pointerLeave(button);
    expect(target.current).toBe(0);
  });
  it("activates on real Tab focus and releases on blur", () => {
    fireEvent.keyDown(document, { key: "Tab" });
    button.focus();
    expect(target.current).toBe(1);
    fireEvent.pointerLeave(button);
    expect(target.current).toBe(1);
    button.blur();
    expect(target.current).toBe(0);
    button.focus();
    expect(target.current).toBe(0);
  });
  it("consumes Tab intent when focus goes to a different control", () => {
    const other = document.createElement("input");
    document.body.append(other);
    fireEvent.keyDown(document, { key: "Tab" });
    other.focus();
    button.focus();
    expect(target.current).toBe(0);
    other.remove();
  });
  it("pointer entry/exit works without focus, and touch does not start hover", () => {
    const move = (pointerType: string, clientX: number) => {
      const event = new Event("pointermove");
      Object.assign(event, { pointerType, clientX, clientY: 24 });
      button.dispatchEvent(event);
    };
    move("touch", 24);
    expect(target.current).toBe(0);
    move("mouse", 24);
    expect(target.current).toBe(1);
    move("mouse", 47);
    expect(target.current).toBe(0);
    move("mouse", 24);
    fireEvent.pointerLeave(button);
    expect(target.current).toBe(0);
  });
  it("a pointer click clears keyboard hover; cleanup detaches all interaction", () => {
    fireEvent.keyDown(document, { key: "Tab" });
    button.focus();
    fireEvent.pointerDown(button);
    fireEvent.pointerLeave(button);
    expect(target.current).toBe(0);
    detach();
    button.blur();
    fireEvent.keyDown(document, { key: "Tab" });
    button.focus();
    expect(target.current).toBe(0);
  });
});
