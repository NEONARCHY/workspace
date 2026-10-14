import { afterEach, expect, it } from "vitest";
import { observePopupInputMode } from "./popup-input-mode";

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; document.body.replaceChildren(); document.documentElement.removeAttribute("data-popup-input"); });
const mode = () => document.documentElement.dataset.popupInput;
const move = (target: Element, x: number, y: number) => target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));

it("switches back to one pointer highlight after keyboard navigation without consuming events", () => {
  stop = observePopupInputMode();
  const popup = document.createElement("div"); popup.className = "fui-Listbox";
  document.body.append(popup);
  const key = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  popup.dispatchEvent(key);
  expect(mode()).toBe("keyboard");
  expect(key.defaultPrevented).toBe(false);
  move(popup, 10, 10);
  expect(mode()).toBe("pointer");
  popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  expect(mode()).toBe("keyboard");
});
it("does not switch modality for stationary layout events or modifier keys", () => {
  stop = observePopupInputMode();
  const popup = document.createElement("div"); popup.className = "fui-MenuList";
  document.body.append(popup);
  move(popup, 10, 20);
  popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  move(popup, 10, 20);
  expect(mode()).toBe("keyboard");
  move(popup, 11, 20);
  popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
  expect(mode()).toBe("pointer");
});
it("handles opening clicks and removes observers on cleanup", () => {
  stop = observePopupInputMode();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(mode()).toBe("keyboard");
  document.dispatchEvent(new MouseEvent("pointerdown", { clientX: 12, clientY: 8 }));
  expect(mode()).toBe("pointer");
  stop(); stop = undefined;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  expect(mode()).toBeUndefined();
});
