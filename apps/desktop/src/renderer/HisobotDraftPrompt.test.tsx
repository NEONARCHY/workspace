import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HisobotActivityDraft, WorkspaceNotification } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentHisobotReminderDay, HisobotDraftPrompt } from "./HisobotDraftPrompt";
import { acknowledgeHisobotActivityDraft, loadHisobotActivityDraft } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadHisobotActivityDraft: vi.fn(), acknowledgeHisobotActivityDraft: vi.fn(),
}));

const reminder: WorkspaceNotification = {
  id: "reminder", kind: "hisobot", priority: "attention", title: "AI Hisobot", body: "Отчёт",
  section: "ai_hisobot", requiresAction: true, isReminder: true, occurredAt: "2026-10-21T12:40:00Z",
};
const draft: HisobotActivityDraft = {
  reportDate: "2026-10-21", generatedAt: "2026-10-21T12:40:00Z", seenAt: null,
  content: "Отчёт за 21.10.2026\n\n1. Подготовлен результат по задаче.", activityCount: 1, omittedCount: 0,
};

describe("Hisobot activity draft prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T12:41:00Z"));
    vi.mocked(loadHisobotActivityDraft).mockResolvedValue(draft);
    vi.mocked(acknowledgeHisobotActivityDraft).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("uses Tashkent dates and suppresses old, resolved, missed, future and out-of-window reminders", () => {
    expect(currentHisobotReminderDay([reminder])).toBe("2026-10-21");
    expect(currentHisobotReminderDay([{ ...reminder, readAt: "2026-10-21T12:40:30Z" }])).toBe("2026-10-21");
    expect(currentHisobotReminderDay([{ ...reminder, occurredAt: "2026-10-20T12:40:00Z" }])).toBeUndefined();
    expect(currentHisobotReminderDay([{ ...reminder, resolvedAt: "2026-10-21T12:40:30Z" }])).toBeUndefined();
    expect(currentHisobotReminderDay([{ ...reminder, isReminder: false }])).toBeUndefined();
    expect(currentHisobotReminderDay([{ ...reminder, occurredAt: "2026-10-21T13:00:00Z" }])).toBeUndefined();
    expect(currentHisobotReminderDay([reminder], new Date("2026-10-21T12:39:59Z"))).toBeUndefined();
    expect(currentHisobotReminderDay([reminder], new Date("2026-10-21T13:30:00Z"))).toBeUndefined();
    expect(currentHisobotReminderDay([{ ...reminder, occurredAt: "2026-10-24T12:40:00Z" }], new Date("2026-10-24T12:41:00Z"))).toBeUndefined();
  });

  it("offers a nonmodal notice without stealing focus or blocking other controls", async () => {
    let complete!: (value: HisobotActivityDraft) => void;
    vi.mocked(loadHisobotActivityDraft).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const onClick = vi.fn();
    render(<><input aria-label="Сообщение" /><button onClick={onClick}>Другой раздел</button><HisobotDraftPrompt token="token" userId="owner" notifications={[reminder]} enabled editingReport={false} onEdit={vi.fn()} /></>);
    const composer = screen.getByRole("textbox", { name: "Сообщение" });
    composer.focus();
    await act(async () => complete(draft));
    expect(screen.getByRole("region", { name: "Черновик ежедневного отчёта" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
    fireEvent.change(composer, { target: { value: "Продолжаю сообщение" } });
    fireEvent.click(screen.getByRole("button", { name: "Другой раздел" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(composer).toHaveValue("Продолжаю сообщение");
  });

  it("hands off the actual draft only on request without submitting or opening an editor globally", async () => {
    const onEdit = vi.fn();
    render(<HisobotDraftPrompt token="token" userId="owner" notifications={[reminder]} enabled editingReport={false} onEdit={onEdit} />);
    await screen.findByRole("region");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Открыть AI Hisobot" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ content: draft.content, reportDate: draft.reportDate }));
    expect(acknowledgeHisobotActivityDraft).toHaveBeenCalledWith("token", "2026-10-21");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("dismisses for the day across reminder slots and reloads even if acknowledgement fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(acknowledgeHisobotActivityDraft).mockRejectedValueOnce(new Error("offline"));
    const props = { token: "token", userId: "owner", enabled: true, editingReport: false, onEdit: vi.fn() };
    const { rerender, unmount } = render(<HisobotDraftPrompt {...props} notifications={[reminder]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Закрыть уведомление AI Hisobot" }));
    await waitFor(() => expect(warning).toHaveBeenCalledOnce());
    rerender(<HisobotDraftPrompt {...props} notifications={[{ ...reminder, id: "second", occurredAt: "2026-10-21T12:40:30Z" }]} />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    unmount();
    render(<HisobotDraftPrompt {...props} notifications={[reminder]} />);
    fireEvent(document, new Event("visibilitychange"));
    expect(loadHisobotActivityDraft).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    warning.mockRestore();
  });

  it("does not auto-open an already seen draft or interrupt the Hisobot editor", async () => {
    vi.mocked(loadHisobotActivityDraft).mockResolvedValue({ ...draft, seenAt: "2026-10-21T12:40:01Z" });
    const props = { token: "token", userId: "owner", notifications: [reminder], enabled: true, onEdit: vi.fn() };
    const { rerender } = render(<HisobotDraftPrompt {...props} editingReport={false} />);
    await waitFor(() => expect(loadHisobotActivityDraft).toHaveBeenCalledOnce());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    vi.mocked(loadHisobotActivityDraft).mockResolvedValue(draft);
    rerender(<HisobotDraftPrompt {...props} editingReport />);
    expect(loadHisobotActivityDraft).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("never requests private data without module access or for a stale reminder", () => {
    const props = { token: "token", userId: "owner", editingReport: false, onEdit: vi.fn() };
    const { rerender } = render(<HisobotDraftPrompt {...props} notifications={[reminder]} enabled={false} />);
    rerender(<HisobotDraftPrompt {...props} enabled notifications={[{ ...reminder, occurredAt: "2026-10-20T12:40:00Z" }]} />);
    expect(loadHisobotActivityDraft).not.toHaveBeenCalled();
  });

  it("explains empty activity without inventing a report and opens Hisobot for manual editing", async () => {
    const onEdit = vi.fn();
    vi.mocked(loadHisobotActivityDraft).mockResolvedValue({ ...draft, content: "", activityCount: 0 });
    render(<HisobotDraftPrompt token="token" userId="owner" notifications={[reminder]} enabled editingReport={false} onEdit={onEdit} />);
    expect(await screen.findByText(/Добавьте выполненную работу вручную/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть AI Hisobot" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ content: "", reportDate: draft.reportDate }));
  });

  it("shows a compact load error with retry and can dismiss it", async () => {
    vi.mocked(loadHisobotActivityDraft).mockRejectedValueOnce(new Error("offline"));
    render(<HisobotDraftPrompt token="token" userId="owner" notifications={[reminder]} enabled editingReport={false} onEdit={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Повторить загрузку" }));
    await screen.findByRole("button", { name: "Открыть AI Hisobot" });
    fireEvent.click(screen.getByRole("button", { name: "Закрыть уведомление AI Hisobot" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(loadHisobotActivityDraft).toHaveBeenCalledTimes(2);
  });

  it("does not overlap another overlay and coalesces visibility refreshes", async () => {
    let complete!: (value: HisobotActivityDraft) => void;
    vi.mocked(loadHisobotActivityDraft).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const props = { token: "token", userId: "owner", notifications: [reminder], enabled: true, editingReport: false, onEdit: vi.fn() };
    const { rerender } = render(<HisobotDraftPrompt {...props} paused />);
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(document, new Event("visibilitychange"));
    expect(loadHisobotActivityDraft).toHaveBeenCalledOnce();
    await act(async () => complete(draft));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    rerender(<HisobotDraftPrompt {...props} paused={false} />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(loadHisobotActivityDraft).toHaveBeenCalledOnce();
  });
});
