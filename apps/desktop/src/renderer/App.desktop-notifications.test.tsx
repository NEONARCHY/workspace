import { act, fireEvent, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GrantDetail } from "@yuksalish/contracts";
import { App } from "./App";
import { people } from "./test-fixtures/demo-data";
import { render, mockServer, loginToWorkspace, clickWithFocus } from "./app-test-harness";
import type { NotificationNavigation } from "./platform-adapter";
import "./GrantsView";

// Native window activation and modal focus need a fresh isolated document.
describe("corporate workspace authentication alpha", () => {
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
    // A closed Fluent surface can already be aria-hidden while its exit lifecycle
    // still owns focus. Reopen only after that old surface has actually unmounted.
    if (dialog.isConnected) await waitForElementToBeRemoved(dialog);
    // A Windows notification reopens the same section without navigating away.
    expect(openDesktopNotification).toBeDefined();
    const workspacePane = await screen.findByRole("main");
    await act(async () => {
      // Electron shows/focuses BrowserWindow before sending notifications:open.
      // Model that activation in jsdom, which has no native desktop window.
      workspacePane.focus();
      fireEvent(window, new Event("focus"));
      openDesktopNotification?.({ id: "notification-grant", section: "grants", entityId: grant.id });
    });
    expect(await screen.findByRole("dialog", { name: grant.title })).toBeInTheDocument();
  });
});
