import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationCenter } from "./NotificationCenter";
import { workspaceTheme } from "./workspace-theme";
import { workspaceSounds } from "./workspace-sounds";

const preferences: NotificationPreferences = { desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true };
const notifications = (unread = 0): WorkspaceNotification[] => Array.from({ length: 300 }, (_, i) => ({
  id: `notification-${i}`, kind: "task", priority: "attention", title: `Событие ${i}`, body: "Рабочее событие", section: "tasks",
  requiresAction: i < 7, isReminder: false, occurredAt: "2026-10-04T00:00:00Z", readAt: i < unread ? null : "2026-10-04T01:00:00Z",
}));
const props = { preferences, onOpen: vi.fn(), onMarkRead: vi.fn(), onMarkAllRead: vi.fn(), onUpdatePreferences: vi.fn() };
const center = (items: readonly WorkspaceNotification[]) => <FluentProvider theme={workspaceTheme}><NotificationCenter {...props} notifications={items} /></FluentProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it("exposes the selected metric and shares a decorative task-style hover layer", () => {
  render(center(notifications(7).slice(0, 2)));
  const metric = screen.getByRole("button", { name: /Новые уведомления/ });
  expect(metric).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(metric);
  expect(metric).toHaveAttribute("aria-pressed", "true");
  const row = screen.getByText("Событие 0").closest("article")!;
  expect(row).toHaveClass("priority-attention");
  expect(row.querySelector(":scope > .list-row-hover-wash")).toHaveAttribute("aria-hidden", "true");
  fireEvent.click(within(row).getByRole("button", { name: /Задачи.*Событие 0/ }));
  expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "notification-0" }));
});

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

it("hides a notification, restores it with undo and sends no delete request", async () => {
  vi.useFakeTimers();
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(<FluentProvider theme={workspaceTheme}><NotificationCenter {...props} notifications={notifications(1).slice(0, 2)} onDelete={onDelete} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Показать действие: Удалить: Событие 0" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить: Событие 0" }));
  expect(screen.queryByText("Событие 0")).not.toBeInTheDocument();
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Вернуть"));
  expect(screen.getByText("Событие 0")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(onDelete).not.toHaveBeenCalled();
});
it("restores the notification after a failed five-second delete", async () => {
  vi.useFakeTimers();
  const onDelete = vi.fn().mockRejectedValue(new Error("Не удалось удалить уведомление"));
  render(<FluentProvider theme={workspaceTheme}><NotificationCenter {...props} notifications={notifications(1).slice(0, 1)} onDelete={onDelete} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Показать действие: Удалить: Событие 0" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить: Событие 0" }));
  await act(() => vi.advanceTimersByTimeAsync(4_999));
  expect(onDelete).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(onDelete).toHaveBeenCalledOnce();
  expect(screen.getByText("Событие 0")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Не удалось удалить уведомление");
});
it("lets employees disable feed and sound without granting desktop notification permission", async () => {
  render(<FluentProvider theme={workspaceTheme}><NotificationCenter {...props} preferences={{ ...preferences, desktopEnabled: false }} notifications={[]} /></FluentProvider>);
  const feed = screen.getByRole("switch", { name: "Лента" });
  expect(feed).toBeEnabled();
  fireEvent.click(feed);
  await waitFor(() => expect(props.onUpdatePreferences).toHaveBeenCalledWith(expect.objectContaining({ feedEnabled: false })));
  await waitFor(() => expect(screen.getByRole("switch", { name: "Звуки уведомлений" })).toBeEnabled());
  fireEvent.click(screen.getByRole("switch", { name: "Звуки уведомлений" }));
  await waitFor(() => expect(props.onUpdatePreferences).toHaveBeenCalledWith(expect.objectContaining({ soundEnabled: false })));
});
it("saves volume explicitly and reports failure without claiming success", async () => {
  const update = vi.fn().mockRejectedValue(new Error("Не удалось сохранить"));
  render(<FluentProvider theme={workspaceTheme}><NotificationCenter {...props} onUpdatePreferences={update} notifications={[]} /></FluentProvider>);
  fireEvent.change(screen.getByRole("slider", { name: "Громкость уведомлений" }), { target: { value: "35" } });
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить громкость" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось сохранить"));
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ soundVolume: 35 }));
  expect(screen.queryByText("Громкость сохранена")).not.toBeInTheDocument();
});
it("previews the selected sound volume from an explicit action", async () => {
  const preview = vi.spyOn(workspaceSounds, "preview").mockResolvedValue();
  render(center([]));
  fireEvent.click(screen.getByRole("button", { name: "Проверить звук" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Звук воспроизведён"));
  expect(preview).toHaveBeenCalledWith(20);
  preview.mockRestore();
});
