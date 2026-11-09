import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMonthlyReportWindow } from "./useMonthlyReports";

afterEach(() => { cleanup(); vi.useRealTimers(); });

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
