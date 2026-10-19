import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ColorThemeSettings } from "./ColorThemeSettings";
import { applyColorTheme, initializeColorTheme, resolveColorTheme, transitionColorTheme, useColorTheme } from "./color-theme";
const originalAnimate = Object.getOwnPropertyDescriptor(document.body, "animate");

afterEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  delete document.documentElement.dataset.colorTheme;
  delete document.documentElement.dataset.themeTransition;
  document.documentElement.style.removeProperty("color-scheme");
  document.documentElement.style.removeProperty("background-color");
  if (originalAnimate) Object.defineProperty(document.body, "animate", originalAnimate);
  else Reflect.deleteProperty(document.body, "animate");
});

it("defaults to the unchanged light theme and rejects malformed stored preferences", () => {
  localStorage.setItem("yuksalish:color-theme:invalid", "neon");
  const hook = renderHook(() => useColorTheme("invalid"));
  expect(hook.result.current.preference).toBe("light");
  expect(document.documentElement).toHaveAttribute("data-color-theme", "light");
});
it("persists a preference, updates all consumers and restores it after remount", () => {
  const a = renderHook(() => useColorTheme("saved")), b = renderHook(() => useColorTheme("saved"));
  act(() => { expect(a.result.current.setPreference("dark")).toBe(true); });
  expect(b.result.current.theme).toBe("dark");
  expect(localStorage.getItem("yuksalish:color-theme:saved")).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  a.unmount(); b.unmount();
  expect(renderHook(() => useColorTheme("saved")).result.current.theme).toBe("dark");
});
it("keeps each employee's choice independent from the sidebar palette", () => {
  localStorage.setItem("yuksalish:color-theme:one", "dark");
  localStorage.setItem("yuksalish:sidebar-theme:one", "navy");
  const hook = renderHook(({ id }) => useColorTheme(id), { initialProps: { id: "one" } });
  expect(hook.result.current.theme).toBe("dark");
  hook.rerender({ id: "two" }); expect(hook.result.current.theme).toBe("light");
  expect(localStorage.getItem("yuksalish:sidebar-theme:one")).toBe("navy");
});
it("bootstraps the last appearance without needing session or API data", () => {
  localStorage.setItem("yuksalish:color-theme:last", "dark"); initializeColorTheme();
  expect(document.documentElement).toHaveAttribute("data-color-theme", "dark");
});
it("synchronizes changes and removal from another tab", () => {
  const hook = renderHook(() => useColorTheme("tabs"));
  act(() => {
    localStorage.setItem("yuksalish:color-theme:tabs", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "yuksalish:color-theme:tabs" }));
  });
  expect(hook.result.current.theme).toBe("dark");
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  expect(hook.result.current.theme).toBe("light");
});
it("retains a live session-only choice and tells the user when storage fails", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  render(<ColorThemeSettings userId="blocked" />);
  fireEvent.click(screen.getByRole("button", { name: /Тёмная/ }));
  expect(screen.getByRole("button", { name: /Тёмная/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status")).toHaveTextContent("сохранить выбор не удалось");
});
it("supports inaccessible storage and environments without matchMedia/animations", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  expect(renderHook(() => useColorTheme(undefined)).result.current.theme).toBe("light");
  expect(resolveColorTheme("system")).toBe("light");
  const update = vi.fn(() => applyColorTheme("dark"));
  await transitionColorTheme(update); expect(update).toHaveBeenCalledOnce();
});
it("follows real system colour changes and releases the shared listener", () => {
  const media = new EventTarget();
  let dark = false;
  const add = vi.spyOn(media, "addEventListener"), remove = vi.spyOn(media, "removeEventListener");
  Object.defineProperty(media, "matches", { get: () => dark });
  vi.stubGlobal("matchMedia", () => media);
  localStorage.setItem("yuksalish:color-theme:system", "system");
  const hook = renderHook(() => useColorTheme("system"));
  expect(hook.result.current.theme).toBe("light");
  act(() => { dark = true; media.dispatchEvent(new Event("change")); });
  expect(hook.result.current.theme).toBe("dark");
  hook.unmount(); expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
});
it("keeps manual light mode unchanged when the system prefers dark", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  expect(resolveColorTheme("light")).toBe("light"); expect(resolveColorTheme("dark")).toBe("dark");
});
it("applies accessible reduced-motion changes immediately", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const update = vi.fn(); await transitionColorTheme(update); expect(update).toHaveBeenCalledOnce();
});

it("never fades the body when native theme snapshots are unavailable", async () => {
  const animate = vi.fn();
  Object.defineProperty(document.body, "animate", { configurable: true, value: animate });
  const update = vi.fn();
  await transitionColorTheme(update);
  expect(update).toHaveBeenCalledOnce();
  expect(animate).not.toHaveBeenCalled();
});

it("keeps the latest choice authoritative even without animation support", async () => {
  const older = vi.fn(), newer = vi.fn();
  await transitionColorTheme(older);
  await transitionColorTheme(newer);
  expect(older).toHaveBeenCalledOnce(); expect(newer).toHaveBeenCalledOnce();
});
