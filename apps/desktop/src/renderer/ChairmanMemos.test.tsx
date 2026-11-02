import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChairmanMemo, ChairmanMemoContext } from "@yuksalish/contracts";
import { ChairmanMemoLauncher, ChairmanMemosDialog } from "./ChairmanMemos";
import { workspaceTheme } from "./workspace-theme";

const api = vi.hoisted(() => ({
  loadChairmanMemoContext: vi.fn(), loadChairmanMemos: vi.fn(), loadChairmanMemo: vi.fn(),
  createChairmanMemo: vi.fn(), saveChairmanMemo: vi.fn(), actOnChairmanMemo: vi.fn(),
  downloadChairmanMemoPdf: vi.fn(),
}));
vi.mock("./workspace-api", () => api);
const context: ChairmanMemoContext = {
  enabled: true, canCreate: true, canReview: false, pendingCount: 0, chairName: "Тестовый председатель",
  requesterName: "Тестовый заместитель", requesterTitle: "Rais o‘rinbosari", configurationError: null,
};
const memo: ChairmanMemo = {
  id: "memo-fixture", title: "Обращение", body: "Полный текст обращения", revision: 1,
  status: "draft", requesterName: "Тестовый заместитель", requesterTitle: "Rais o‘rinbosari",
  chairName: "Тестовый председатель", createdAt: "2026-11-02T10:00:00+05:00", submittedAt: null,
  decidedAt: null, decisionComment: "", canEdit: true, canSubmit: true, canDecide: false,
  canWithdraw: false, hasPdf: true, pdfByteSize: 12000,
};
beforeEach(() => {
  vi.resetAllMocks();
  api.loadChairmanMemoContext.mockResolvedValue(context);
  api.loadChairmanMemos.mockResolvedValue({ items: [], total: 0 });
  api.loadChairmanMemo.mockResolvedValue(memo);
  api.createChairmanMemo.mockResolvedValue(memo);
});
afterEach(cleanup);
function dialog(initialId?: string) {
  return render(<FluentProvider theme={workspaceTheme}><ChairmanMemosDialog token="test-token" userId="deputy" initialId={initialId} onClose={vi.fn()} /></FluentProvider>);
}
describe("private memorandum UI", () => {
  it("hides the launcher without server-granted access", async () => {
    api.loadChairmanMemoContext.mockResolvedValue({ ...context, enabled: false, canCreate: false });
    render(<ChairmanMemoLauncher token="test-token" userId="employee" onOpen={vi.fn()} />);
    await waitFor(() => expect(api.loadChairmanMemoContext).toHaveBeenCalled());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("shows the chair's pending count and opens its dialog", async () => {
    const open = vi.fn();
    api.loadChairmanMemoContext.mockResolvedValue({ ...context, canCreate: false, canReview: true, pendingCount: 3 });
    render(<ChairmanMemoLauncher token="test-token" userId="chair" onOpen={open} />);
    const button = await screen.findByRole("button", { name: /Билдирги на согласование/ });
    expect(button).toHaveTextContent("3"); fireEvent.click(button); expect(open).toHaveBeenCalledOnce();
  });
  it("preserves text and the idempotency key after failed creation", async () => {
    api.createChairmanMemo.mockRejectedValueOnce(new Error("Сеть недоступна"));
    dialog();
    fireEvent.click(await screen.findByRole("button", { name: "Написать билдирги" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Тема обращения/ }), { target: { value: "Обращение" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Текст билдирги/ }), { target: { value: "Полный текст обращения" } });
    expect(screen.getByText("Тестовый председатель")).toBeInTheDocument();
    expect(screen.getByText("Тестовый заместитель")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(screen.getByRole("textbox", { name: /Текст билдирги/ })).toHaveValue(memo.body);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByRole("button", { name: "Отправить председателю" });
    expect(api.createChairmanMemo).toHaveBeenCalledTimes(2);
    const firstKey = api.createChairmanMemo.mock.calls.at(0)?.[2];
    expect(firstKey).toEqual(expect.any(String));
    expect(firstKey).toBe(api.createChairmanMemo.mock.calls.at(1)?.[2]);
  });
  it("requires saving before submitting a changed text", async () => {
    dialog(memo.id);
    const submit = await screen.findByRole("button", { name: "Отправить председателю" });
    fireEvent.change(screen.getByRole("textbox", { name: /Текст билдирги/ }), { target: { value: "Новая редакция" } });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("button", { name: "Посмотреть PDF" })).toBeDisabled();
  });
  it("keeps the chair's decision and comment pending after server failure", async () => {
    api.loadChairmanMemoContext.mockResolvedValue({ ...context, canCreate: false, canReview: true });
    api.loadChairmanMemo.mockResolvedValue({ ...memo, status: "pending", revision: 2, canEdit: false, canSubmit: false, canDecide: true });
    api.actOnChairmanMemo.mockRejectedValue(new Error("Конфликт версии"));
    dialog(memo.id);
    const approve = await screen.findByRole("button", { name: "Одобрить билдирги" });
    expect(screen.queryByRole("textbox", { name: /Текст билдирги/ })).not.toBeInTheDocument();
    const comment = screen.getByRole("textbox", { name: "Комментарий к решению" });
    fireEvent.change(comment, { target: { value: "Уточните основание" } });
    fireEvent.click(approve);
    expect(await screen.findByRole("alert")).toHaveTextContent("Конфликт версии");
    expect(comment).toHaveValue("Уточните основание");
    expect(approve).toBeEnabled();
    expect(screen.queryByText("Одобрено председателем")).not.toBeInTheDocument();
  });
});
