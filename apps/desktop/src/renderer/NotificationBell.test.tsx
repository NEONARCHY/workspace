import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { NotificationBell } from "./NotificationBell";

it("opens notifications without marking them read and decorates only unread state", () => {
  const onOpen = vi.fn();
  const { rerender } = render(<NotificationBell unreadCount={2} active={false} onOpen={onOpen} />);
  const bell = screen.getByRole("button", { name: "Уведомления" });
  expect(bell).toHaveAttribute("aria-description", "Уведомления: непрочитанных 2");
  expect(bell).toHaveAttribute("data-unread", "true");
  expect(bell.querySelector(".notification-bell-dot")).not.toBeNull();
  fireEvent.click(bell);
  expect(onOpen).toHaveBeenCalledOnce();
  rerender(<NotificationBell unreadCount={0} active={true} onOpen={onOpen} />);
  expect(screen.getByRole("button", { name: "Уведомления" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Уведомления" })).not.toHaveAttribute("data-unread");
  expect(document.querySelector(".notification-bell-dot")).toBeNull();
});
it("runs one second of transform-only movement every eight seconds and honours reduced motion", () => {
  const css = readFileSync("src/renderer/notification-bell.css", "utf8");
  expect(css).toContain("8s ease-in-out infinite");
  expect(css).toContain("0%, 12.5%, 100%");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("animation: none;");
  const app = readFileSync("src/renderer/App.tsx", "utf8");
  expect(app).toContain('key !== "project_funding" && key !== "notifications"');
  expect(app.indexOf("<NotificationBell")).toBeLessThan(app.indexOf("<ColorThemeToggle"));
});
it("uses the neighbouring theme button's surface with matching compact corners", () => {
  const css = readFileSync("src/renderer/notification-bell.css", "utf8");
  const theme = readFileSync("src/renderer/dark-theme.css", "utf8");
  const surface = "background: var(--ws-button-hover, var(--ws-surface));";
  expect(css).toContain(surface);
  expect(theme).toContain(surface);
  expect(css).toContain(".browser-compact .global-bar .notification-bell { width: 48px; height: 48px; border-radius: 14px; }");
  expect(css).toContain("background: ButtonFace; border: 1px solid ButtonText;");
});
