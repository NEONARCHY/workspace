import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationCenter } from "./NotificationCenter";
import { workspaceTheme } from "./workspace-theme";

const preferences: NotificationPreferences = { desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true };
const notifications = (unread = 0): WorkspaceNotification[] => Array.from({ length: 300 }, (_, i) => ({
  id: `notification-${i}`, kind: "task", priority: "attention", title: `Событие ${i}`, body: "Рабочее событие", section: "tasks",
  requiresAction: i < 7, isReminder: false, occurredAt: "2026-10-04T00:00:00Z", readAt: i < unread ? null : "2026-10-04T01:00:00Z",
}));
const props = { preferences, onOpen: vi.fn(), onMarkRead: vi.fn(), onMarkAllRead: vi.fn(), onUpdatePreferences: vi.fn() };
const center = (items: readonly WorkspaceNotification[]) => <FluentProvider theme={workspaceTheme}><NotificationCenter {...props} notifications={items} /></FluentProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows 100% read while seven unresolved actions remain in the queue", () => {
  render(center(notifications()));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  expect(within(screen.getByRole("group", { name: "Прочтение уведомлений" })).getByText("100%")).toBeInTheDocument();
  expect(screen.getAllByText("нужно действие")).toHaveLength(7);
  expect(screen.getByRole("button", { name: "Прочитать все" })).toBeDisabled();
});
it.each([[7, "98"], [1, "99"], [300, "0"]])("counts %i unread independently of working actions", (unread, expected) => {
  render(center(notifications(unread)));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", expected);
});
it("updates only from confirmed read data and retains the unresolved queue", () => {
  const view = render(center(notifications(7)));
  fireEvent.click(screen.getByRole("button", { name: "Прочитать все" }));
  expect(props.onMarkAllRead).toHaveBeenCalledOnce();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "98");
  view.rerender(center(notifications()));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  expect(screen.getAllByText("нужно действие")).toHaveLength(7);
});
it("does not claim that an empty history is fully read", () => {
  render(center([]));
  const summary = screen.getByRole("group", { name: "Прочтение уведомлений" });
  expect(within(summary).getByText("—")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Пока нет уведомлений");
});
