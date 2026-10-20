import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GrantDetail } from "@yuksalish/contracts";
import type { NotificationNavigation } from "./platform-adapter";
import { App } from "./App";
import { initialTasks, people } from "./test-fixtures/demo-data";
import { render, mockServer, loginToWorkspace, clickWithFocus } from "./app-test-harness";

import "./TasksView";
import "./ApprovalsView";
import "./GrantsView";

describe("corporate workspace authentication alpha", () => {
  it("opens the unread queue, marks an item read and follows its deep link", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(screen.getByRole("heading", { name: "Требует моего внимания" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Новые уведомления/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Уведомления" })).toHaveAttribute("aria-description", "Уведомления: непрочитанных 2");
    expect(document.querySelector(".notification-bell-dot")).not.toBeNull();
    expect(screen.getByText("1", { selector: ".notification-metrics strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Задача требует внимания").closest("button")!);
    expect(await screen.findByRole("heading", { name: initialTasks[0]!.title })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/notification-task/read"),
      expect.objectContaining({ method: "PATCH" }),
    ));
    await waitFor(() => expect(document.querySelector(".tasks-view")).not.toBeNull(), { timeout: 5000 });
    const taskDialogClose = document.querySelector<HTMLButtonElement>(".task-detail-close");
    expect(taskDialogClose).not.toBeNull();
    fireEvent.click(taskDialogClose!);
    await waitFor(() => expect(document.querySelector(".task-record-dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 5000 }));
    expect(await screen.findByRole("heading", { name: initialTasks[1]!.title }, { timeout: 6000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: "Прочитать все" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/read-all"),
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("updates the read percentage after confirmation without resolving actions", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: "Прочитать все" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/read-all"),
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Доля прочитанных уведомлений" })).toHaveAttribute("aria-valuenow", "100"));
    expect(screen.getByRole("button", { name: /Нужно решить/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Прочитать все" })).toBeDisabled();
  });

  it("filters the notification queue by its source without losing history", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: /Вся история/ }));
    expect(screen.getByText("Задача требует внимания")).toBeInTheDocument();
    expect(screen.getByText("Новое сообщение · Финансы и закупки")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "Фильтр по разделу" }))
      .getByRole("button", { name: "Мессенджер" }));
    expect(screen.queryByText("Задача требует внимания")).not.toBeInTheDocument();
    expect(screen.getByText("Новое сообщение · Финансы и закупки")).toBeInTheDocument();
  });

  it("allows closing and reopening a request reached through a notification", async () => {
    mockServer({
      withReturnedRequest: true,
      extraNotifications: [{
        id: "notification-approval",
        kind: "approval",
        priority: "attention",
        title: "Исправить заявку",
        body: "Вернувшаяся заявка",
        section: "payment_requests",
        entityId: "returned-request",
        requiresAction: true,
        isReminder: false,
        occurredAt: "2026-09-04T09:30:00Z",
      }],
    });
    render(<App />);
    await loginToWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByText("Исправить заявку").closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Вернувшаяся заявка" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку заявки" }));
    expect(screen.queryByRole("dialog", { name: "Вернувшаяся заявка" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(await screen.findByRole("button", { name: /Новые уведомления/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Исправить заявку")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Нужно решить/ }));
    fireEvent.click(screen.getByText("Исправить заявку").closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Вернувшаяся заявка" })).toBeInTheDocument();
  });

  it("reopens the same grant from its notification after closing the card", async () => {
    let openDesktopNotification: ((payload: NotificationNavigation) => void) | undefined;
    vi.stubGlobal("yuksalish", { ...window.yuksalish,
      onNotificationOpen: (listener: (payload: NotificationNavigation) => void) => {
        openDesktopNotification = listener;
        return () => { openDesktopNotification = undefined; };
      },
    });
    const grant: GrantDetail = {
      id: "grant-notification", title: "Проверить грантовую заявку", description: "План и бюджет",
      authorUserId: people[0]!.id, assigneeId: people[1]!.id, coAssigneeIds: [],
      leaderUserId: people[1]!.id, chairUserId: people[2]!.id, dueAt: "2099-11-01T12:00:00Z",
      status: "author_review", revision: 1, checklist: [], resultText: "Материалы готовы",
      chatId: "grant-chat", createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z",
      allowedActions: ["approve", "return", "comment"], events: [], attachments: [],
    };
    mockServer({ grant, extraNotifications: [{
      id: "notification-grant", kind: "approval", priority: "attention", title: "Грант ждёт решения",
      body: grant.title, section: "grants", entityId: grant.id, requiresAction: true,
      isReminder: false, occurredAt: "2026-10-20T12:00:00Z",
    }] });
    render(<App />);
    await loginToWorkspace("aziza", "home");
    clickWithFocus(screen.getByRole("button", { name: "Уведомления" }));
    clickWithFocus(screen.getByText("Грант ждёт решения").closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: grant.title });
    clickWithFocus(await within(dialog).findByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: grant.title })).not.toBeInTheDocument());
    // A Windows notification reopens the same section without navigating away.
    expect(openDesktopNotification).toBeDefined();
    act(() => openDesktopNotification?.({ id: "notification-grant", section: "grants", entityId: grant.id }));
    expect(await screen.findByRole("dialog", { name: grant.title })).toBeInTheDocument();
  });
});
