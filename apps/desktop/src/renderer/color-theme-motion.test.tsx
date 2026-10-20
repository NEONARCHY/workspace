import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ColorThemeToggle } from "./ColorThemeToggle";
import { applyColorTheme, transitionColorTheme, useColorTheme } from "./color-theme";
import { WorkspaceFluentProvider } from "./WorkspaceFluentProvider";

const root = document.documentElement;
const originalStart = Object.getOwnPropertyDescriptor(document, "startViewTransition");
const originalAnimate = Object.getOwnPropertyDescriptor(root, "animate");
const originalRequestFrame = Object.getOwnPropertyDescriptor(window, "requestAnimationFrame");
const originalCancelFrame = Object.getOwnPropertyDescriptor(window, "cancelAnimationFrame");

function frameQueue() {
  const callbacks: FrameRequestCallback[] = [];
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; },
  });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: vi.fn() });
  return { callbacks, flush: () => callbacks.shift()?.(performance.now()) };
}

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  if (originalStart) Object.defineProperty(document, "startViewTransition", originalStart);
  else Reflect.deleteProperty(document, "startViewTransition");
  if (originalAnimate) Object.defineProperty(root, "animate", originalAnimate);
  else Reflect.deleteProperty(root, "animate");
  if (originalRequestFrame) Object.defineProperty(window, "requestAnimationFrame", originalRequestFrame);
  else Reflect.deleteProperty(window, "requestAnimationFrame");
  if (originalCancelFrame) Object.defineProperty(window, "cancelAnimationFrame", originalCancelFrame);
  else Reflect.deleteProperty(window, "cancelAnimationFrame");
  delete root.dataset.themeTransition; delete root.dataset.colorTheme;
  root.style.removeProperty("color-scheme"); root.style.removeProperty("background-color");
});

it("applies the theme immediately without capturing or animating a page snapshot", async () => {
  const frames = frameQueue();
  const start = vi.fn(), animate = vi.fn();
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
  Object.defineProperty(root, "animate", { configurable: true, value: animate });
  const update = vi.fn(() => applyColorTheme("dark"));
  const pending = transitionColorTheme(update);

  expect(update).toHaveBeenCalledOnce();
  expect(root).toHaveAttribute("data-color-theme", "dark");
  expect(root).toHaveAttribute("data-theme-transition", "true");
  expect(start).not.toHaveBeenCalled(); expect(animate).not.toHaveBeenCalled();
  const css = readFileSync("src/renderer/color-theme-motion.css", "utf8");
  expect(css).toContain("transition: none !important");
  expect(css).not.toContain("view-transition");

  await act(async () => { frames.flush(); });
  expect(root).toHaveAttribute("data-theme-transition", "true");
  await act(async () => { frames.flush(); await pending; });
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("keeps the one-frame suppression until the latest rapid theme choice paints", async () => {
  const frames = frameQueue();
  const older = vi.fn(), newer = vi.fn();
  const first = transitionColorTheme(older), last = transitionColorTheme(newer);
  expect(older).toHaveBeenCalledOnce(); expect(newer).toHaveBeenCalledOnce();

  frames.flush();
  expect(root).toHaveAttribute("data-theme-transition", "true");
  frames.flush();
  frames.flush();
  expect(root).toHaveAttribute("data-theme-transition", "true");
  frames.flush();
  await first;
  await last;
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("clears the frame guard after an update error", async () => {
  frameQueue();
  await expect(transitionColorTheme(() => { throw new Error("theme update failed"); }))
    .rejects.toThrow("theme update failed");
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("wires the topbar toggle to the immediate theme update", async () => {
  const frames = frameQueue();
  render(<ColorThemeToggle userId="theme-toggle" />);
  fireEvent.click(screen.getByRole("button", { name: "Включить тёмную тему" }));
  expect(root).toHaveAttribute("data-color-theme", "dark");
  expect(screen.getByRole("button", { name: "Включить светлую тему" })).toBeInTheDocument();
  expect(localStorage.getItem("yuksalish:color-theme:theme-toggle")).toBe("dark");
  await act(async () => { frames.flush(); frames.flush(); });
  expect(root).not.toHaveAttribute("data-theme-transition");
});

it("does not rerender unrelated app children when the provider theme changes", () => {
  const childRender = vi.fn();
  function UnrelatedChild() { childRender(); return <span>Содержимое страницы</span>; }
  function ThemeChoice() {
    const { theme, setPreference } = useColorTheme("provider-isolation");
    return <button type="button" onClick={() => setPreference(theme === "dark" ? "light" : "dark")}>Поменять тему</button>;
  }
  render(<WorkspaceFluentProvider userId="provider-isolation"><><ThemeChoice /><UnrelatedChild /></></WorkspaceFluentProvider>);
  expect(childRender).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Поменять тему" }));
  expect(root).toHaveAttribute("data-color-theme", "dark");
  expect(childRender).toHaveBeenCalledTimes(1);
});
