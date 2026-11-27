import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMonthlyReports, useMonthlyReportWindow } from "./useMonthlyReports";
import { loadMonthlyReports } from "./workspace-api";
import type { MonthlyOverview } from "@yuksalish/contracts";

vi.mock("./workspace-api", () => ({ loadMonthlyReports: vi.fn() }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("coalesces automatic refreshes, aborts a superseded read and rejects stale sessions", async () => {
  vi.useFakeTimers();
  let resolveOld!: (value: MonthlyOverview) => void;
  vi.mocked(loadMonthlyReports).mockReturnValueOnce(new Promise(done => { resolveOld = done; }))
    .mockReturnValue(new Promise(() => undefined));
  const view = renderHook(({ token }) => useMonthlyReports(token, true), { initialProps: { token: "old" } });
  const firstSignal = vi.mocked(loadMonthlyReports).mock.calls[0]![1]!;
  await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(30_000); });
  expect(loadMonthlyReports).toHaveBeenCalledOnce();
  view.rerender({ token: "new" });
  expect(firstSignal.aborted).toBe(true);
  expect(loadMonthlyReports).toHaveBeenCalledTimes(2);
  await act(async () => { resolveOld({ today: "2026-11-26", activeMonth: null, dashboardVisible: false, canReview: false, canAuthorize: false, canConfigure: false, reminderMonth: null, payrollNotice: null, payrollNoticeId: null, cycles: [], reports: [] }); });
  expect(view.result.current.data).toBeUndefined();
  expect(view.result.current.loading).toBe(true);
  const latestSignal = vi.mocked(loadMonthlyReports).mock.calls[1]![1]!;
  await act(async () => { void view.result.current.refresh(); });
  expect(latestSignal.aborted).toBe(true);
  const finalSignal = vi.mocked(loadMonthlyReports).mock.calls[2]![1]!;
  view.unmount();
  expect(finalSignal.aborted).toBe(true);
});

it("restores the actual launcher after the old modal detaches, including pointer clicks without focus", async () => {
  vi.useFakeTimers();
  const launcher = document.createElement("button");
  const surface = document.createElement("div"); surface.setAttribute("role", "dialog");
  document.body.append(launcher, surface);
  const { result } = renderHook(() => useMonthlyReportWindow("owner"));
  act(() => result.current.show(launcher));
  expect(result.current.open).toBe(true);
  act(() => { result.current.hide(); result.current.afterClose(surface); });
  await act(async () => vi.advanceTimersByTime(40));
  expect(document.activeElement).not.toBe(launcher);
  surface.remove();
  await act(async () => vi.advanceTimersByTime(40));
  expect(document.activeElement).toBe(launcher);
  launcher.remove();
});

it("does not steal focus from another dialog opened while closing reports", async () => {
  vi.useFakeTimers();
  const launcher = document.createElement("button");
  const other = document.createElement("div"); other.setAttribute("role", "dialog");
  const input = document.createElement("input"); other.append(input);
  document.body.append(launcher, other); input.focus();
  const { result } = renderHook(() => useMonthlyReportWindow("owner"));
  act(() => { result.current.show(launcher); result.current.hide(); result.current.afterClose(null); });
  await act(async () => vi.advanceTimersByTime(40));
  expect(document.activeElement).toBe(input);
  launcher.remove(); other.remove();
});
