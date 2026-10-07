import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SidebarAppearanceSettings } from "./SidebarAppearanceSettings";
import { useSidebarTheme } from "./sidebar-theme";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("defaults to blue-teal and ignores invalid saved values", () => {
  const { result, rerender } = renderHook(({ id }) => useSidebarTheme(id), { initialProps: { id: "default" } });
  expect(result.current.theme).toBe("blue-teal");
  localStorage.setItem("yuksalish:sidebar-theme:invalid", "unknown");
  rerender({ id: "invalid" });
  expect(result.current.theme).toBe("blue-teal");
});

it("persists explicit choices, updates consumers and restores them after remount", () => {
  const first = renderHook(() => useSidebarTheme("saved"));
  const second = renderHook(() => useSidebarTheme("saved"));
  act(() => { expect(first.result.current.setTheme("light")).toBe(true); });
  expect(second.result.current.theme).toBe("light");
  expect(localStorage.getItem("yuksalish:sidebar-theme:saved")).toBe("light");
  first.unmount(); second.unmount();
  expect(renderHook(() => useSidebarTheme("saved")).result.current.theme).toBe("light");
});

it("separates employees' preferences without stale state on account changes", () => {
  localStorage.setItem("yuksalish:sidebar-theme:one", "navy");
  const { result, rerender } = renderHook(({ id }) => useSidebarTheme(id), { initialProps: { id: "one" } });
  expect(result.current.theme).toBe("navy");
  rerender({ id: "two" });
  expect(result.current.theme).toBe("blue-teal");
  rerender({ id: "one" });
  expect(result.current.theme).toBe("navy");
});

it("follows changes and resets from another browser tab", () => {
  const { result } = renderHook(() => useSidebarTheme("tabs"));
  act(() => {
    localStorage.setItem("yuksalish:sidebar-theme:tabs", "navy");
    window.dispatchEvent(new StorageEvent("storage", { key: "yuksalish:sidebar-theme:tabs", storageArea: localStorage }));
  });
  expect(result.current.theme).toBe("navy");
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage })); });
  expect(result.current.theme).toBe("blue-teal");
});

it("applies a session-only choice and reports unavailable persistence", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  render(<SidebarAppearanceSettings userId="blocked-write" />);
  fireEvent.click(screen.getByRole("button", { name: "Светлый" }));
  expect(screen.getByRole("button", { name: "Светлый" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status")).toHaveTextContent("не удалось сохранить");
});

it("provides labelled choices and allows restoring the default", () => {
  render(<SidebarAppearanceSettings userId="choices" />);
  expect(screen.getByRole("group", { name: "Цвет бокового меню" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Тёмно-синий" }));
  expect(screen.getByRole("button", { name: "Тёмно-синий" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Сине-бирюзовый По умолчанию" }));
  expect(screen.getByRole("button", { name: "Сине-бирюзовый По умолчанию" })).toHaveAttribute("aria-pressed", "true");
});
