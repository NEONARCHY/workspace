import { afterEach, expect, it, vi } from "vitest";
import { mockVisibleWindowLayout } from "./visible-window";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("provides layout only for visible, connected elements", () => {
  mockVisibleWindowLayout();
  const parent = document.createElement("div");
  const button = document.createElement("button");
  parent.append(button);
  document.body.append(parent);
  expect(document.body.getBoundingClientRect().width).toBeGreaterThan(0);
  expect(button.offsetParent).toBe(parent);
  parent.hidden = true;
  expect(button.offsetParent).toBeNull();
  parent.hidden = false;
  parent.style.display = "none";
  expect(button.offsetParent).toBeNull();
  parent.style.display = "block";
  button.hidden = true;
  expect(button.offsetParent).toBeNull();
  button.hidden = false;
  button.style.position = "fixed";
  expect(button.offsetParent).toBeNull();
  button.style.position = "static";
  parent.remove();
  expect(button.offsetParent).toBeNull();
});

it("can restore jsdom layout after the scenario", () => {
  const rect = document.body.getBoundingClientRect();
  const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  mockVisibleWindowLayout();
  vi.restoreAllMocks();
  expect(document.body.getBoundingClientRect()).toEqual(rect);
  expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")).toEqual(offsetParent);
});
