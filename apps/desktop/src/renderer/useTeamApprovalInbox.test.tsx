import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadTeamApprovalInbox } from "./workspace-api";
import { useTeamApprovalInbox } from "./useTeamApprovalInbox";

vi.mock("./workspace-api", () => ({ loadTeamApprovalInbox: vi.fn() }));
const item = { id: "trip", title: "Поездка", requesterName: "Сотрудник", startsOn: "2026-11-01", endsOn: "2026-11-02" };
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("does not request queues without module access and hides another actor's inbox", async () => {
  const { result, rerender } = renderHook(({ enabled }) => useTeamApprovalInbox("token", "deputy", "trips", enabled), { initialProps: { enabled: false } });
  expect(loadTeamApprovalInbox).not.toHaveBeenCalled();
  expect(result.current.visible).toBe(false);
  vi.mocked(loadTeamApprovalInbox).mockResolvedValue({ enabled: false, items: [] });
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.visible).toBe(false);
});

it("keeps errors unknown, retries and refreshes on focus", async () => {
  vi.mocked(loadTeamApprovalInbox).mockRejectedValueOnce(new Error("Нет связи"))
    .mockResolvedValueOnce({ enabled: true, items: [item] })
    .mockResolvedValue({ enabled: true, items: [] });
  const { result } = renderHook(() => useTeamApprovalInbox("token", "deputy", "trips", true));
  await waitFor(() => expect(result.current.error).toBe("Нет связи"));
  expect(result.current.items).toBeUndefined();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.items).toEqual([item]));
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current.items).toEqual([]));
});

it("drops data on refresh failure and cannot leak between users", async () => {
  vi.mocked(loadTeamApprovalInbox).mockResolvedValueOnce({ enabled: true, items: [item] })
    .mockRejectedValueOnce(new Error("Доступ изменён"))
    .mockResolvedValue({ enabled: false, items: [] });
  const { result, rerender } = renderHook(({ user }) => useTeamApprovalInbox("token", user, "trips", true), { initialProps: { user: "deputy" } });
  await waitFor(() => expect(result.current.items).toEqual([item]));
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current.error).toBe("Доступ изменён"));
  expect(result.current.items).toBeUndefined();
  rerender({ user: "other" });
  expect(result.current.items).toBeUndefined();
  await waitFor(() => expect(result.current.visible).toBe(false));
});

it("polls only visible pages, restores visibility and aborts on unmount", async () => {
  vi.useFakeTimers();
  vi.mocked(loadTeamApprovalInbox).mockResolvedValue({ enabled: true, items: [] });
  const { unmount } = renderHook(() => useTeamApprovalInbox("token", "deputy", "leaves", true));
  await act(async () => { await Promise.resolve(); });
  const signal = vi.mocked(loadTeamApprovalInbox).mock.calls[0]?.[2];
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(loadTeamApprovalInbox).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(loadTeamApprovalInbox).toHaveBeenCalledTimes(2);
  await act(async () => { vi.advanceTimersByTime(15_000); });
  expect(loadTeamApprovalInbox).toHaveBeenCalledTimes(3);
  unmount();
  expect(signal?.aborted).toBe(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});
