import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { applyColorTheme, transitionColorTheme } from "./color-theme";
import { ColorThemeToggle } from "./ColorThemeToggle";

const root = document.documentElement;
const originalStart = Object.getOwnPropertyDescriptor(document, "startViewTransition");
const originalAnimate = Object.getOwnPropertyDescriptor(root, "animate");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  localStorage.clear();
  if (originalStart) Object.defineProperty(document, "startViewTransition", originalStart);
  else Reflect.deleteProperty(document, "startViewTransition");
  if (originalAnimate) Object.defineProperty(root, "animate", originalAnimate);
  else Reflect.deleteProperty(root, "animate");
  delete root.dataset.themeTransition; delete root.dataset.colorTheme;
  root.style.removeProperty("color-scheme"); root.style.removeProperty("background-color");
});

function fixture() {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("innerWidth", 1000); vi.stubGlobal("innerHeight", 800);
  const entries: { run: () => Promise<void>; fail: () => void; finish: () => void; skip: ReturnType<typeof vi.fn> }[] = [];
  const start = vi.fn((update: () => void) => {
    let ready!: () => void, fail!: () => void, finish!: () => void;
    const readyPromise = new Promise<void>((resolve, reject) => { ready = resolve; fail = () => reject(new Error("Skipped")); });
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const skip = vi.fn(() => { fail(); finish(); });
    entries.push({ run: async () => { update(); ready(); }, fail, finish, skip });
    return { ready: readyPromise, finished, skipTransition: skip };
  });
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
  let end!: () => void;
  const cancel = vi.fn();
  const animate = vi.fn(() => {
    let reject!: () => void;
    const finished = new Promise<void>((resolve, fail) => { end = resolve; reject = () => fail(new Error("Cancelled")); });
    cancel.mockImplementation(reject);
    return { finished, cancel };
  });
  Object.defineProperty(root, "animate", { configurable: true, value: animate });
  return { entries, start, animate, cancel, finish: () => { end(); entries.at(-1)!.finish(); } };
}

it.each(["dark", "light"] as const)("reveals %s from the trigger to the farthest corner without losing draft or focus", async theme => {
  const f = fixture();
  render(<input aria-label="Черновик" defaultValue="Сохраняемый текст" />);
  const input = screen.getByRole("textbox"); input.focus();
  const update = vi.fn(() => applyColorTheme(theme));
  const pending = transitionColorTheme(update, { x: 900, y: 40 });
  expect(update).not.toHaveBeenCalled();
  await f.entries[0]!.run();
  expect(update).toHaveBeenCalledOnce();
  expect(root).toHaveAttribute("data-color-theme", theme);
  expect(f.animate).toHaveBeenCalledWith([
    { clipPath: "circle(0px at 900px 40px)" },
    { clipPath: `circle(${Math.ceil(Math.hypot(900, 760)) + 2}px at 900px 40px)` },
  ], expect.objectContaining({ duration: 560, pseudoElement: "::view-transition-new(root)" }));
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input).toHaveValue("Сохраняемый текст"); expect(input).toHaveFocus();
  f.finish(); await pending;
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("skips an obsolete pending choice on rapid reversal", async () => {
  const f = fixture(), older = vi.fn(), newer = vi.fn();
  const first = transitionColorTheme(older), last = transitionColorTheme(newer);
  expect(f.entries[0]!.skip).toHaveBeenCalledOnce();
  await f.entries[0]!.run(); await f.entries[1]!.run();
  expect(older).not.toHaveBeenCalled(); expect(newer).toHaveBeenCalledOnce();
  f.finish(); await Promise.all([first, last]);
  expect(f.animate).toHaveBeenCalledOnce();
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("applies once if native snapshots fail before their callback", async () => {
  const f = fixture(), update = vi.fn();
  const pending = transitionColorTheme(update);
  f.entries[0]!.fail(); await pending;
  await f.entries[0]!.run();
  expect(update).toHaveBeenCalledOnce(); expect(f.animate).not.toHaveBeenCalled();
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("settles immediately and releases listeners when reduced motion is enabled mid-wave", async () => {
  const f = fixture(), media = new EventTarget(); let reduced = false;
  Object.defineProperty(media, "matches", { get: () => reduced });
  vi.stubGlobal("matchMedia", () => media);
  const add = vi.spyOn(media, "addEventListener"), remove = vi.spyOn(media, "removeEventListener");
  const update = vi.fn(), pending = transitionColorTheme(update);
  await f.entries[0]!.run();
  reduced = true; media.dispatchEvent(new Event("change")); await pending;
  expect(update).toHaveBeenCalledOnce(); expect(f.cancel).toHaveBeenCalled();
  expect(add).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("applies immediately in hidden tabs without creating snapshots", async () => {
  const f = fixture(); vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const update = vi.fn(); await transitionColorTheme(update);
  expect(update).toHaveBeenCalledOnce(); expect(f.start).not.toHaveBeenCalled();
});

it("keeps snapshots opaque, unscaled and transparent to input", () => {
  const css = readFileSync("src/renderer/color-theme-motion.css", "utf8");
  expect(css).toContain("animation: none"); expect(css).toContain("pointer-events: none");
  expect(css).toContain("mix-blend-mode: normal"); expect(css).toContain("z-index: 2");
  expect(css).not.toMatch(/opacity|scale\(/);
});

it.each([0, 1])("uses the actual toggle's centre for activation detail=%s", async detail => {
  const f = fixture();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 40, 40));
  render(<ColorThemeToggle userId="wave-origin" />);
  fireEvent.click(screen.getByRole("button", { name: "Включить тёмную тему" }), { detail });
  await act(async () => f.entries[0]!.run());
  expect(f.animate).toHaveBeenCalledWith(expect.arrayContaining([{ clipPath: "circle(0px at 40px 50px)" }]), expect.anything());
  expect(screen.getByRole("button", { name: "Включить светлую тему" })).toBeInTheDocument();
  await act(async () => { f.finish(); });
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("falls back immediately if native snapshot creation throws", async () => {
  const f = fixture(), update = vi.fn();
  f.start.mockImplementationOnce(() => { throw new Error("Snapshot unavailable"); });
  await transitionColorTheme(update);
  expect(update).toHaveBeenCalledOnce(); expect(f.animate).not.toHaveBeenCalled();
  expect(root).not.toHaveAttribute("data-theme-transition");
});
