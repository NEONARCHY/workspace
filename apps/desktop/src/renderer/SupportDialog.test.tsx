import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportRegistry } from "@yuksalish/contracts";

import { workspaceTheme } from "./workspace-theme";
import { SupportDialog } from "./SupportDialog";
import {
  actOnSupportRequest,
  createSupportRequest,
  loadSupportRegistry,
  markSupportResponsesRead,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  actOnSupportRequest: vi.fn(),
  createSupportRequest: vi.fn(),
  loadSupportRegistry: vi.fn(),
  markSupportResponsesRead: vi.fn(),
}));

const request = {
  id: "request-1",
  authorId: "employee-1",
  authorName: "Азиза Каримова",
  authorUsername: "aziza",
  category: "bug" as const,
  subject: "Не открывается календарь",
  body: "После нажатия календарь остаётся пустым.",
  status: "open" as const,
  responseUnread: false,
  createdAt: "2026-09-27T08:00:00Z",
  updatedAt: "2026-09-27T08:00:00Z",
  messages: [{
    id: "message-1",
    requestId: "request-1",
    authorId: "employee-1",
    authorName: "Азиза Каримова",
    kind: "submission" as const,
    body: "После нажатия календарь остаётся пустым.",
    createdAt: "2026-09-27T08:00:00Z",
  }],
};

const personalRegistry: SupportRegistry = {
  mode: "support",
  indicator: null,
  unreadResponseCount: 0,
  requests: [request],
};
const inboxRegistry: SupportRegistry = { ...personalRegistry, mode: "inbox" };

beforeEach(() => {
  vi.mocked(loadSupportRegistry).mockResolvedValue(personalRegistry);
  vi.mocked(markSupportResponsesRead).mockResolvedValue(undefined);
  vi.mocked(createSupportRequest).mockResolvedValue(request);
  vi.mocked(actOnSupportRequest).mockResolvedValue(request);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SupportDialog", () => {
  it("lets an employee send feedback and keeps their request history", async () => {
    render(
      <FluentProvider theme={workspaceTheme}>
        <SupportDialog open token="token" registry={personalRegistry} onOpenChange={vi.fn()} onRegistryChange={vi.fn()} />
      </FluentProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Поддержка" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Не открывается календарь/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Тема" }), { target: { value: "Новая идея" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Описание" }), { target: { value: "Добавить быстрый фильтр для встреч" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить обращение" }));
    await waitFor(() => expect(createSupportRequest).toHaveBeenCalledWith("token", {
      category: "comment",
      subject: "Новая идея",
      body: "Добавить быстрый фильтр для встреч",
    }));
  });

  it("gives administrators comment, implemented and rejected actions", async () => {
    vi.mocked(loadSupportRegistry).mockResolvedValue(inboxRegistry);
    render(
      <FluentProvider theme={workspaceTheme}>
        <SupportDialog open token="token" registry={inboxRegistry} onOpenChange={vi.fn()} onRegistryChange={vi.fn()} />
      </FluentProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Обращения сотрудников" })).toHaveTextContent("@aziza");
    fireEvent.change(screen.getByRole("textbox", { name: "Комментарий сотруднику" }), { target: { value: "Уточните версию приложения" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить комментарий" }));
    await waitFor(() => expect(actOnSupportRequest).toHaveBeenCalledWith("token", "request-1", {
      action: "comment",
      body: "Уточните версию приложения",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Уже реализовано" }));
    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    await waitFor(() => expect(actOnSupportRequest).toHaveBeenLastCalledWith("token", "request-1", {
      action: "reject",
      rejectionReason: "already_implemented",
      body: undefined,
    }));
  });
});
