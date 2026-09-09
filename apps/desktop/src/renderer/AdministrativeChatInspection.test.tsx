import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdministrativeChatInspectionView } from "./AdministrativeChatInspection";
import {
  createAdministrativeChatInspection,
  loadAdministrativeChats,
  revokeAdministrativeChatInspection,
} from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({
  loadAdministrativeChats: vi.fn(),
  createAdministrativeChatInspection: vi.fn(),
  revokeAdministrativeChatInspection: vi.fn(),
}));

const chat = {
  id: "chat-one",
  title: "Азиза — Дилшод",
  kind: "direct",
  members: [
    { userId: "one", name: "Азиза Каримова", status: "active" },
    { userId: "two", name: "Дилшод Рахимов", status: "active" },
  ],
  messageCount: 1,
  updatedAt: "2026-09-09T08:00:00Z",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadAdministrativeChats).mockResolvedValue([chat]);
  vi.mocked(revokeAdministrativeChatInspection).mockResolvedValue();
  vi.mocked(createAdministrativeChatInspection).mockResolvedValue({
    id: "inspection-one",
    chat,
    reason: "Проверка обращения сотрудника",
    createdAt: "2026-09-09T08:00:00Z",
    expiresAt: "2026-09-09T08:30:00Z",
    totalMessages: 1,
    truncated: false,
    messages: [{
      id: "message-one",
      authorUserId: "one",
      authorName: "Азиза Каримова",
      body: "Текст для проверки",
      createdAt: "2026-09-09T07:55:00Z",
    }],
  });
});
afterEach(cleanup);

describe("Controlled administrative chat inspection", () => {
  it("requires a reason and exposes messages only in a read-only timed session", async () => {
    render(<FluentProvider theme={workspaceTheme}><AdministrativeChatInspectionView token="token" onClose={vi.fn()} /></FluentProvider>);
    expect(await screen.findAllByText("Азиза — Дилшод")).toHaveLength(2);
    const open = screen.getByRole("button", { name: "Открыть для просмотра" });
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Основание административного просмотра"), { target: { value: "Проверка обращения сотрудника" } });
    fireEvent.click(open);
    expect(await screen.findByText("Текст для проверки")).toBeInTheDocument();
    expect(createAdministrativeChatInspection).toHaveBeenCalledWith(
      "token", "chat-one", "Проверка обращения сотрудника", 30,
    );
    expect(screen.queryByRole("textbox", { name: /сообщение/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Завершить просмотр" }));
    await waitFor(() => expect(revokeAdministrativeChatInspection).toHaveBeenCalledWith("token", "inspection-one"));
  });

  it("closes without granting access when no inspection was started", async () => {
    const onClose = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><AdministrativeChatInspectionView token="token" onClose={onClose} /></FluentProvider>);
    await screen.findAllByText("Азиза — Дилшод");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть контроль чатов" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(revokeAdministrativeChatInspection).not.toHaveBeenCalled();
  });
});
