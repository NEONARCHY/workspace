import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("automatically offers a visible editable draft and copies the actual edited text without submitting", async () => {
    const onEdit = vi.fn();
    render(<HisobotDraftPrompt token="token" userId="owner" notifications={[reminder]} enabled editingReport={false} onEdit={onEdit} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Готовый текст — можно редактировать сразу" }), { target: { value: "Мой дополненный отчёт" } });
    fireEvent.click(screen.getByRole("button", { name: "Скопировать" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Мой дополненный отчёт"));
    expect(screen.getByText("Текст скопирован. Отчёт ещё не отправлен.")).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
    expect(acknowledgeHisobotActivityDraft).toHaveBeenCalledWith("token", "2026-10-21");
    fireEvent.click(screen.getByRole("button", { name: "Открыть в AI Hisobot" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ content: "Мой дополненный отчёт", reportDate: "2026-10-21" }));
  });

  it("preserves edits on close/reopen and does not repeat the popup for the next reminder slot", async () => {
    const props = { token: "token", userId: "owner", enabled: true, editingReport: false, onEdit: vi.fn() };
    const { rerender } = render(<HisobotDraftPrompt {...props} notifications={[reminder]} />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Несохранённое дополнение" } });
    fireEvent.click(screen.getByRole("button", { name: "Позже" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(<HisobotDraftPrompt {...props} notifications={[{ ...reminder, id: "second", occurredAt: "2026-10-21T12:40:30Z" }]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Посмотреть" }));
    expect(await screen.findByDisplayValue("Несохранённое дополнение")).toBeInTheDocument();
  });

  it("does not auto-open an already seen draft or interrupt the Hisobot editor", async () => {
    vi.mocked(loadHisobotActivityDraft).mockResolvedValue({ ...draft, seenAt: "2026-10-21T12:40:01Z" });
    const props = { token: "token", userId: "owner", notifications: [reminder], enabled: true, onEdit: vi.fn() };
    const { rerender } = render(<HisobotDraftPrompt {...props} editingReport={false} />);
    await screen.findByRole("button", { name: "Посмотреть" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    vi.mocked(loadHisobotActivityDraft).mockResolvedValue(draft);
    rerender(<HisobotDraftPrompt {...props} editingReport />);
    await waitFor(() => expect(loadHisobotActivityDraft).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never requests private data without module access or for a stale reminder", () => {
    const props = { token: "token", userId: "owner", editingReport: false, onEdit: vi.fn() };
    const { rerender } = render(<HisobotDraftPrompt {...props} notifications={[reminder]} enabled={false} />);
    rerender(<HisobotDraftPrompt {...props} enabled notifications={[{ ...reminder, occurredAt: "2026-10-20T12:40:00Z" }]} />);
    expect(loadHisobotActivityDraft).not.toHaveBeenCalled();
  });

  it("explains empty activity without inventing a report and supports manual editing", async () => {
    vi.mocked(loadHisobotActivityDraft).mockResolvedValue({ ...draft, content: "", activityCount: 0 });
    render(<HisobotDraftPrompt token="token" userId="owner" notifications={[reminder]} enabled editingReport={false} onEdit={vi.fn()} />);
    expect(await screen.findByText(/Это не означает, что вы не работали/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скопировать" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("shows load/copy/ack errors, supports retry and keeps the text", async () => {
    vi.mocked(loadHisobotActivityDraft).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(acknowledgeHisobotActivityDraft).mockRejectedValue(new Error("offline"));
    render(<HisobotDraftPrompt token="token" userId="owner" notifications={[reminder]} enabled editingReport={false} onEdit={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));
    await screen.findByRole("dialog");
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Скопировать" }));
    expect(await screen.findByText(/Выделите текст/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(draft.content);
    fireEvent.click(screen.getByRole("button", { name: "Позже" }));
    expect(await screen.findByText(/При следующем входе предложение может появиться снова/)).toBeInTheDocument();
  });
});
