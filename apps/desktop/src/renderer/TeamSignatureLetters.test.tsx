import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIReferentLetter, AIReferentRegistry } from "@yuksalish/contracts";
import { TeamDashboardView } from "./TeamDashboardView";
import { workspaceTheme } from "./workspace-theme";
import { loadSignatureInbox } from "./workspace-api";

vi.mock("./TeamPresencePanel", () => ({ TeamPresencePanel: () => <div /> }));
vi.mock("./workspace-api", () => ({ loadSignatureInbox: vi.fn() }));

const letter: AIReferentLetter = {
  id: "letter", subject: "Письмо партнёру", recipientOrganization: "Организация", recipientAddress: "partner@example.test",
  route: "webmail", note: "", status: "pending_review", workflowKind: "delivery", source: "workspace",
  createdByUserId: "author", createdByName: "Каримова Азиза Баходировна", reviewerUserId: "chairman",
  revision: 1, createdAt: "2026-10-19T08:00:00Z", updatedAt: "2026-10-19T08:00:00Z",
  attachments: [], events: [], availableActions: ["approve", "return_for_revision"], canEdit: false,
};
function registry(totalCount = 1, letters: readonly AIReferentLetter[] = [letter]): AIReferentRegistry {
  return { letters, totalCount, pendingReviewCount: totalCount, readyCount: 0, sentCount: 0, signedCount: 0 };
}
function dashboard(onSelect: ((id: string) => void) | undefined = vi.fn(), token = "token", user = "chairman") {
  return <FluentProvider theme={workspaceTheme}><TeamDashboardView token={token} currentUserId={user} tasks={[]} people={[]} efficiencyLoading={false} onSelectTask={vi.fn()} onSelectPaymentRequest={vi.fn()} onSelectSignatureLetter={onSelect} /></FluentProvider>;
}
const tile = () => screen.getByRole("button", { name: /Письма на подпись/ });
const panel = () => screen.getByRole("region", { name: "Письма, ожидающие вашей подписи" });

describe("team signature inbox", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(loadSignatureInbox).mockReset().mockResolvedValue(registry()); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("adds the sixth metric with the server total and opens either kind of letter", async () => {
    const onSelect = vi.fn();
    vi.mocked(loadSignatureInbox).mockResolvedValue(registry(25, [letter, { ...letter, id: "packet", subject: "Пакет документов", workflowKind: "sign_only" }]));
    await act(async () => { render(dashboard(onSelect)); });
    expect(within(screen.getByRole("region", { name: "Ключевые показатели команды" })).getAllByRole("button")).toHaveLength(6);
    expect(tile()).toHaveTextContent("25");
    expect(loadSignatureInbox).toHaveBeenCalledWith("token", 0);
    fireEvent.click(tile());
    expect(tile()).toHaveAttribute("aria-pressed", "true");
    expect(panel()).toHaveTextContent("Азиза Каримова");
    expect(panel()).not.toHaveTextContent("Баходировна");
    fireEvent.click(within(panel()).getByRole("button", { name: /Письмо партнёру/ }));
    expect(onSelect).toHaveBeenLastCalledWith("letter");
    fireEvent.click(within(panel()).getByRole("button", { name: /Пакет документов/ }));
    expect(onSelect).toHaveBeenLastCalledWith("packet");
    fireEvent.click(within(panel()).getByRole("button", { name: "Скрыть" }));
    expect(tile()).toHaveAttribute("aria-pressed", "false");
  });

  it("does not fetch or expose the tile without module access", async () => {
    await act(async () => { render(<TeamDashboardView token="token" currentUserId="user" tasks={[]} people={[]} efficiencyLoading={false} onSelectTask={vi.fn()} />); });
    expect(screen.queryByRole("button", { name: /Письма на подпись/ })).not.toBeInTheDocument();
    expect(loadSignatureInbox).not.toHaveBeenCalled();
  });

  it("shows an error instead of zero and supports retry", async () => {
    vi.mocked(loadSignatureInbox).mockRejectedValueOnce(new Error("Сервер недоступен"));
    await act(async () => { render(dashboard()); });
    expect(tile()).toHaveTextContent("—");
    fireEvent.click(tile());
    expect(within(panel()).getByRole("alert")).toHaveTextContent("Сервер недоступен");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку писем" })); });
    expect(tile()).toHaveTextContent("1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("paginates at 20 without truncating the total and clamps a vanished last page", async () => {
    vi.mocked(loadSignatureInbox).mockResolvedValueOnce(registry(21));
    await act(async () => { render(dashboard()); });
    fireEvent.click(tile());
    vi.mocked(loadSignatureInbox).mockResolvedValueOnce(registry(21, [{ ...letter, id: "last", subject: "Последнее письмо" }]));
    await act(async () => { fireEvent.click(within(panel()).getByRole("button", { name: "Далее" })); });
    expect(loadSignatureInbox).toHaveBeenLastCalledWith("token", 20);
    expect(panel()).toHaveTextContent("Последнее письмо");
    expect(within(panel()).getByRole("button", { name: "Далее" })).toBeDisabled();
    vi.mocked(loadSignatureInbox).mockResolvedValue(registry(0, []));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(loadSignatureInbox).toHaveBeenLastCalledWith("token", 0);
    expect(panel()).toHaveTextContent("Писем, ожидающих вашей подписи, нет.");
    expect(tile()).toHaveTextContent("0");
  });

  it("never displays a late response from a previous account", async () => {
    let resolveOld!: (value: AIReferentRegistry) => void;
    vi.mocked(loadSignatureInbox).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const view = render(dashboard());
    fireEvent.click(tile());
    expect(screen.getByRole("status", { name: "Загружаем письма на подпись" })).toBeInTheDocument();
    vi.mocked(loadSignatureInbox).mockResolvedValue(registry(0, []));
    await act(async () => { view.rerender(dashboard(vi.fn(), "new-token", "another")); });
    await act(async () => { resolveOld(registry(99)); });
    expect(tile()).toHaveTextContent("0");
    expect(panel()).not.toHaveTextContent("Письмо партнёру");
  });

  it("refreshes on window focus and stops polling on unmount", async () => {
    const view = render(dashboard());
    await act(async () => {});
    vi.mocked(loadSignatureInbox).mockResolvedValue(registry(0, []));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(tile()).toHaveTextContent("0");
    view.unmount();
    vi.mocked(loadSignatureInbox).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); window.dispatchEvent(new Event("focus")); });
    expect(loadSignatureInbox).not.toHaveBeenCalled();
  });
});
